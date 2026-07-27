<div align="center">

# 단숨 · Dansum

### 단숨에 파악하는 경제 이슈

흩어진 경제 뉴스를 AI가 요약하고, 여러 매체의 보도를 하나로 묶어
**지금 중요한 이슈를 한눈에** 보여주는 한국어 경제 뉴스 플랫폼입니다.

[**dansum-web.pages.dev →**](https://dansum-web.pages.dev)

![Deployed on Cloudflare](https://img.shields.io/badge/deployed-Cloudflare-f38020?logo=cloudflare&logoColor=white)

<sub>Astro · Hono · Cloudflare Workers · D1 · OpenAI</sub>

</div>

---

## 소개

경제 뉴스는 많지만, 정작 "**오늘 뭐가 중요한지**"를 파악하는 데는 시간이 듭니다.
단숨은 국내외 경제 매체의 기사를 30분마다 자동 수집해 AI로 요약하고,
같은 사건을 다룬 여러 매체의 보도를 하나의 이슈로 묶습니다.

- 📰 **AI 요약** — 기사를 *요약 → 주요 내용(소제목·불릿) → 핵심 포인트* 구조로 정리
- 🔥 **오늘의 주요 뉴스** — 보도량과 신선도를 함께 반영해 지금 뜨는 이슈를 상단에
- 🌐 **국내외 통합** — 영문 기사도 한국어로 번역·요약해 국내 보도와 같은 흐름에서 클러스터링
- 🔎 **관련도 검색** — 다중 키워드 AND + 필드 가중치 기반 정렬
- 🌙 **다크 모드** — 타이포그래피 중심의 라이트/다크 테마

## 주요 기능

| 기능 | 설명 |
| --- | --- |
| 뉴스 피드 | 최신순 목록 · 무한 더보기 · 카테고리 필터 |
| 오늘의 주요 뉴스 | 매체 교차 클러스터링 → `보도량 × 신선도 감쇠` 랭킹 · 급상승/NEW 뱃지 |
| 기사 상세 | 요약 · 주요 내용(sections) · 핵심 포인트 · 원문 링크 |
| 카테고리 | 금융 · 증시 · 산업·기업 · 부동산 · 무역·통상 · 거시·정책 |
| 검색 | 다중 단어 AND · 관련도 정렬 · 최근 검색어 |

## 아키텍처

수집부터 노출까지 전 과정이 Cloudflare 엣지 위에서 동작합니다.
자동 수집 파이프라인은 **cron 30분 주기**로 한 번에 수집 → 본문 추출 → AI 요약을 처리합니다.

```
 RSS 소스 (국내 4 · 해외 6)
        │
        ▼
┌──────────────────────────────────────────────┐
│   dansum-pipeline  (Cloudflare Workers · cron */30)   │
│                                                        │
│   수집 ──▶ 본문 추출 ──▶ AI 요약/번역 ──▶ D1 저장       │
│  (RSS)   (경량 파서)   (OpenAI · JSON)                 │
└──────────────────────────────────────────────┘
        │                                  ▲
        ▼                                  │ 캐시 무효화
  ┌───────────┐   조회    ┌───────────┐   │
  │  D1 (SQL) │ ◀──────── │ dansum-api│   │
  └───────────┘           │  (Hono)   │───┘
        ▲                 └───────────┘
        │                       ▲ JSON
   KV 캐시 (30분)                │
                          ┌───────────┐
                          │ dansum-web│  Astro + React Islands
                          │  (Pages)  │
                          └───────────┘
```

- **클러스터링** — 키워드 중첩 기반 그리디 군집화로 같은 사건의 여러 보도를 묶고, 매체 수(보도량)와 시간 감쇠를 곱해 랭킹
- **캐시** — API 응답을 KV에 30분 캐시하되, 파이프라인이 새 기사를 커밋하면 홈 피드 캐시를 즉시 무효화해 지연 없이 반영
- **무료 플랜 최적화** — 호출당 서브리퀘스트 50개 한도 안에서 동작하도록 D1 쓰기를 `batch()`로 일괄 처리

## 기술 스택

| 영역 | 사용 기술 |
| --- | --- |
| 프론트엔드 | Astro · React Islands · Tailwind CSS v4 |
| 백엔드 API | Hono on Cloudflare Workers |
| 파이프라인 | Cloudflare Workers (cron) · 경량 본문 추출 |
| AI | OpenAI `gpt-4.1-mini` (Chat Completions · JSON 모드) · Cloudflare AI Gateway |
| 데이터 | Cloudflare D1 (SQLite) · KV (캐시) |
| 인프라 | Cloudflare Pages · Workers |
| 개발 | pnpm 모노레포 · TypeScript · Biome · Vitest |

## 뉴스 소스

- 🇰🇷 **국내** — 연합뉴스 경제 · 한국경제 · 매일경제 · 서울경제
- 🇺🇸 **해외** — CNBC (Economy·Finance) · NPR Business · Federal Reserve · MarketWatch · Yahoo Finance

<sub>페이월 없는 무료 접근 RSS만 사용합니다. 해외 영문 기사는 요약 단계에서 한국어로 번역됩니다.</sub>

## 모노레포 구조

```
dansum/
├─ apps/
│  ├─ web/           # Astro 프론트엔드 (Cloudflare Pages)
│  └─ api/           # Hono API (Cloudflare Workers)
├─ workers/
│  ├─ collector/     # 통합 파이프라인 (cron: 수집→추출→요약)
│  ├─ fetcher/       # 본문 추출 (로컬/Phase B용)
│  └─ summarizer/    # AI 요약 로직 (파이프라인이 재사용)
├─ packages/
│  ├─ shared/        # 공용 타입 · 상수 · 유틸
│  └─ db/            # D1 마이그레이션 · 시드
└─ scripts/          # 시드 내보내기 등 유틸
```

## 로컬 실행

> 요구사항: Node.js ≥ 20, pnpm

```bash
# 의존성 설치
pnpm install

# 웹 (http://localhost:4321)
pnpm dev

# API (http://localhost:8787) — 별도 터미널
pnpm dev:api
```

로컬 파이프라인(수집→추출→요약) 검증과 D1 마이그레이션·시드는
[`RUNBOOK.md`](./RUNBOOK.md)를 참고하세요.

## 배포

Cloudflare 무료 플랜 위에서 동작합니다.

- **Web** — Cloudflare Pages (`dansum-web`)
- **API** — Cloudflare Workers (`dansum-api`)
- **파이프라인** — Cloudflare Workers · cron `*/30` (`dansum-pipeline`)

AI 요약에는 `OPENAI_API_KEY`가 필요하며 `wrangler secret`으로 주입합니다.
자세한 단계는 [`RUNBOOK.md`](./RUNBOOK.md)와 배포 노트를 참고하세요.

---

<div align="center">
<sub>© 2026 Dansum · 개인 프로젝트</sub>
</div>
