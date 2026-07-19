# 단숨(Dansum) 본문 크롤링 파이프라인 설계

## 배경 / 목표
현재 파이프라인은 RSS의 `title` + 짧은 `description`만으로 요약한다. 입력이 빈약해
gpt-4.1-mini가 본문에 없는 수치·날짜를 추론(환각)하는 문제가 관찰됨. 프롬프트 제약(규칙 7·8)으로
1차 완화했으나, 근본 해결은 **기사 본문 확보**다.

목표: collector가 수집한 기사 URL을 방문해 **본문 전문을 추출**하고 `raw_articles.content`에 채운 뒤
요약하게 하여 요약 품질을 높이고, 해외(특히 미국) 무료 소스를 추가한다.

## 결정 사항 (확정)
- **소스 범위**: 무료 접근 가능 소스만. 페이월(NYT/WSJ/Bloomberg/FT 등)은 제외.
- **추출 방식**: 범용 Readability (`linkedom` + `@mozilla/readability`).
- **파이프라인 배치**: 전용 `fetcher` 워커 + 큐 (collector → fetcher → summarizer).
- **번역**: 영문 본문 → 한국어 요약은 기존 summarizer 프롬프트 규칙 3이 처리.

---

## 아키텍처 (변경 후)

```
[Cron 30분] → Collector
  - RSS fetch + dedup (기존)
  - INSERT raw_articles (status='pending', content=NULL)
  - enqueue → FETCH_QUEUE { rawArticleId, url, language }      ← 변경 (기존: SUMMARIZE_QUEUE)

[Fetcher Worker]  (FETCH_QUEUE consumer, 신규)
  - fetch(url) HTML (User-Agent 명시, 크기 상한)
  - Readability로 본문 추출 (linkedom DOM)
  - UPDATE raw_articles SET content=?, status='fetched'
  - enqueue → SUMMARIZE_QUEUE { rawArticleId, sourceId, sourceName }
  - 실패: 재시도 → 영구 실패 시 description 기반으로라도 요약하도록 폴백 enqueue

[Summarizer Worker]  (SUMMARIZE_QUEUE consumer, 기존)
  - 이제 raw_articles.content(실제 본문) 사용 → 요약 품질 향상
  - 본문 없으면(폴백) 기존처럼 description 사용
```

### 상태 흐름 (`raw_articles.status`, TEXT라 스키마 변경 불필요)
`pending` → `fetching` → `fetched` → `processing` → `completed`
- 분기: `fetch_failed`(본문 추출 영구 실패, description 폴백), `failed`(요약 실패)

---

## 신규 워커: `workers/fetcher`
```
workers/fetcher/
  wrangler.toml          # FETCH_QUEUE consumer + SUMMARIZE_QUEUE producer + DB
  package.json           # deps: linkedom, @mozilla/readability, @dansum/shared
  src/
    index.ts             # queue() consumer + dev용 /process
    extract.ts           # HTML → { title, text } (Readability 래퍼)
    sources/ (불필요, collector config 재사용)
```

### wrangler.toml (요지)
```toml
name = "dansum-fetcher"
[[d1_databases]] binding = "DB"  database_name = "dansum-db"
[[queues.consumers]] queue = "dansum-fetch"     max_batch_size = 3  max_batch_timeout = 30
[[queues.producers]] queue = "dansum-summarize" binding = "SUMMARIZE_QUEUE"
[vars] MAX_HTML_BYTES = "800000"
```
- collector의 `[[queues.producers]]`는 `dansum-summarize` → **`dansum-fetch`** 로 변경,
  바인딩명 `SUMMARIZE_QUEUE` → `FETCH_QUEUE`.
- 신규 큐 `dansum-fetch` 생성 필요(배포 시).

### extract.ts (핵심 로직)
```ts
import { parseHTML } from "linkedom";
import { Readability } from "@mozilla/readability";

export function extractArticle(html: string): { title: string; text: string } | null {
  const { document } = parseHTML(html);
  const reader = new Readability(document);
  const article = reader.parse();           // { title, textContent, ... } | null
  if (!article?.textContent) return null;
  return { title: article.title ?? "", text: article.textContent.trim() };
}
```

### Workers 런타임 주의점
- `linkedom`/`@mozilla/readability`는 순수 JS라 Workers에서 동작하나, 큰 HTML 파싱은 **CPU 소모가 큼**.
  → fetch 후 `MAX_HTML_BYTES`로 HTML을 잘라서 파싱(상한 ~800KB), 본문 텍스트도 상한(예: 8천 자)으로 trim.
- **JS 렌더링 전용(SPA) 사이트**는 정적 HTML에 본문이 없어 추출 실패 → description 폴백.
- 배치 작게(`max_batch_size=3`), 도메인별 과도 요청 회피(예의 + 차단 방지).

---

## 소스 전략

### 한국 (기존 4개 — 본문 크롤링 추가 적용)
연합/한경/매경/서울경제. 이제 본문까지 추출.

### 미국 무료 소스 (후보 — 배포 전 `scripts/test-rss.ts`로 RSS 유효성 검증 필수)
| id | 매체 | 분류 | 비고 |
|----|------|------|------|
| cnbc-economy | CNBC Economy | global | RSS 안정적 |
| cnbc-finance | CNBC Finance | finance | |
| marketwatch-top | MarketWatch Top | market | RSS 변동 잦음, 검증 필요 |
| npr-business | NPR Business | global | `feeds.npr.org/1006/rss.xml` |
| fed-press | Federal Reserve 보도자료 | policy | `federalreserve.gov/feeds/press_all.xml`, 1차 출처·번역 가치 큼 |
| treasury-press | 美 재무부 보도자료 | policy | |
| yahoo-finance | Yahoo Finance | market | 종목/일반 피드 |

- AP·Reuters는 공개 RSS가 불안정/폐지되어 후순위(검증 후 채택).
- 새 소스는 `workers/collector/src/sources/config.ts`와 `packages/db/seed/sources.sql` 양쪽에 추가(현 구조 유지).
- `language: "en"` 소스는 summarizer가 자동 번역.

---

## 실패 / 폴백 처리
1. HTTP 실패·타임아웃 → queue `retry()` (max 3회, 기존 `MAX_RETRY_COUNT` 재사용).
2. 추출 결과 비거나 너무 짧음(예: <200자) → `fetch_failed` 기록 후 **description 폴백으로 summarize enqueue**
   (요약은 짧게 — 프롬프트 규칙 8과 맞물림).
3. summarizer는 `content` 우선, 없으면 `description` 사용(이미 `buildUserPrompt`가 그렇게 동작).

## 법적 / 예의(Politeness)
- **요약만 저장·게시, 본문 전문은 요약 입력용으로만 사용하고 영구 게시하지 않음**. 항상 원문 링크 제공(기존 정책 유지).
- 크롤링 대상은 "무료 접근 + 크롤링 허용"으로 사전 검증한 소스로 한정. robots.txt 존중.
- 식별 가능한 User-Agent(`Dansum-News-Collector/0.x (+연락처)`), 저빈도(30분 주기 + 작은 배치).

---

## 구현 단계
1. **의존성·스캐폴드**: `workers/fetcher` 생성, `linkedom`·`@mozilla/readability` 추가.
2. **extract.ts** 작성 + 단위 검증(샘플 HTML로 추출 확인).
3. **fetcher index.ts**: queue consumer + dev용 `/process`(로컬 검증, summarizer 패턴 동일).
4. **collector 변경**: producer를 `FETCH_QUEUE`(`dansum-fetch`)로 교체, 메시지에 `url`·`language` 포함.
5. **미국 소스 추가**: config + seed, `scripts/test-rss.ts`로 피드 검증(죽은 피드 제거).
6. **로컬 E2E**: 공유 `--persist-to`로 collector→fetcher→summarizer→api→web 전 구간 재검증(RUNBOOK 절차 확장).
7. **RUNBOOK 갱신**: fetcher 실행 단계, `dansum-fetch` 큐 생성(배포 항목) 추가.

## 검증
- `scripts/test-rss.ts`: 신규 미국 피드 도달성·파싱 확인.
- 신규 `scripts/test-extract.ts`(선택): 실제 기사 URL 몇 개로 Readability 추출 품질 확인.
- 로컬: collector `/trigger` → fetcher `/process`로 content 채움 확인(`SELECT length(content)`) → summarizer `/process` →
  요약에 **본문 기반 디테일이 들어오고 환각이 줄었는지** 육안 확인 → api/web 렌더.

## 남은 리스크 / 열린 질문
- 일부 사이트 봇 차단(403)·SPA 렌더 → 폴백으로 흡수하되 비율 모니터링 필요.
- Workers CPU 한도: 대용량 HTML 파싱 시 초과 가능 → 크기 상한·조기 중단으로 관리.
- 미국 RSS 피드 안정성 편차 → 채택 전 검증 필수, 일부는 탈락 가능.
- (확장) 본문 확보가 어려운 소스는 추후 공식 API(예: 일부 매체 제공) 검토.
```
