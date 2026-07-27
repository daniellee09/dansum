# 단숨(Dansum) 로컬 실행 가이드

자격증명(Cloudflare 계정 / OpenAI API 키) 없이 로컬 Miniflare로 전체 파이프라인을 돌리는 절차.
모든 워커가 **하나의 공유 상태 디렉터리**(`.wrangler-state`)를 쓰도록 `--persist-to`를 반드시 동일하게 지정한다.

> 참고: 현재 wrangler가 워크스페이스에 설치돼 있지 않아 `npx wrangler@4.100.0` 로 호출한다.
> `apps/api`에서는 `npx wrangler`가 바이너리를 못 찾는 경우가 있어 루트에서 `--config`로 실행한다.

## 사전 준비
```bash
pnpm install
```

## 1. RSS 피드 검증
```bash
pnpm dlx tsx scripts/test-rss.ts
```
각 소스의 HTTP 상태·파싱 아이템 수·샘플을 출력. 실패 소스는
`workers/collector/src/sources/config.ts` 와 `packages/db/seed/sources.sql`를 함께 수정.

## 2. 로컬 D1 초기화 (스키마 + 시드)
```bash
cd workers/collector
npx wrangler@4.100.0 d1 execute dansum-db --local --persist-to ../../.wrangler-state \
  --file=../../packages/db/migrations/0001_initial_schema.sql -y
npx wrangler@4.100.0 d1 execute dansum-db --local --persist-to ../../.wrangler-state \
  --file=../../packages/db/seed/sources.sql -y
```

## 3. Collector 실행 → 뉴스 수집
```bash
cd workers/collector
npx wrangler@4.100.0 dev --persist-to ../../.wrangler-state --port 8788 --ip 127.0.0.1
```
다른 터미널에서:
```bash
curl http://127.0.0.1:8788/trigger        # 수집 시작 (raw_articles 적재 + dansum-fetch 큐 전송)
```
확인:
```bash
npx wrangler@4.100.0 d1 execute dansum-db --local --persist-to ../../.wrangler-state \
  --command "SELECT status, count(*) FROM raw_articles GROUP BY status" -y
```
`/trigger`를 다시 호출해도 총건수가 유지되면 중복 제거(dedup) 정상.

## 4. Fetcher 실행 → 본문 추출
```bash
# 루트에서 (npx가 wrangler를 못 찾는 케이스 회피)
cd e:/Dansum
npx --yes wrangler@4.100.0 dev --config workers/fetcher/wrangler.toml \
  --persist-to .wrangler-state --port 8790 --ip 127.0.0.1
```
다른 터미널에서 pending이 0이 될 때까지 호출:
```bash
curl http://127.0.0.1:8790/process        # pending 기사 URL 방문 → 본문 추출 → status='fetched'
```
- Readability로 본문 추출(`linkedom` + `@mozilla/readability`). 추출 실패(SPA·봇차단 등)면
  `content=NULL`로 두고 그대로 `fetched` 전이 → summarizer가 description 폴백으로 요약.
- 확인: `SELECT status, count(*), sum(content IS NOT NULL) FROM raw_articles GROUP BY status`

## 5. Summarizer 실행 → 요약 (API 키 없으면 자동 mock)
```bash
cd workers/summarizer
npx wrangler@4.100.0 dev --persist-to ../../.wrangler-state --port 8789 --ip 127.0.0.1
```
다른 터미널에서 `fetched`가 0이 될 때까지 호출:
```bash
curl http://127.0.0.1:8789/process        # fetched 50건씩 처리 → articles 테이블에 저장
```
- `OPENAI_API_KEY`가 없으면 `workers/summarizer/src/claude/client.ts`의 mock 분기가
  결정적 가짜 요약을 생성한다(로그에 `[DEV MOCK]`).
- **실제 요약을 보려면**: `workers/summarizer/.dev.vars`에
  `OPENAI_API_KEY=sk-...` 추가 후 재실행하면 자동으로 실제 API 경로 사용
  (OpenAI Chat Completions, 모델은 `gpt-4.1-mini`, JSON 모드).
- `/process`는 로컬 검증용. 실제 운영에서는 Fetcher가 큐로 보낸 메시지를
  Summarizer의 `queue()` 컨슈머가 자동 처리한다.

## 6. API 실행
```bash
# 루트에서 (apps/api 안에서 npx가 wrangler를 못 찾는 케이스 회피)
cd e:/Dansum
npx --yes wrangler@4.100.0 dev --config apps/api/wrangler.toml \
  --persist-to .wrangler-state --port 8787 --ip 127.0.0.1
```
확인:
```bash
curl "http://127.0.0.1:8787/api/articles?page=1&pageSize=2"   # 최신순 목록(중요도 정렬 제거됨)
curl "http://127.0.0.1:8787/api/articles?category=finance"    # 카테고리: finance|market|industry|realestate|trade|macro|general
curl "http://127.0.0.1:8787/api/categories"
curl "http://127.0.0.1:8787/api/articles/<id>"
curl "http://127.0.0.1:8787/api/top?limit=6"                  # 오늘의 주요 뉴스(보도량 클러스터링)
```

## 7. Web 실행
`apps/web/.env`:
```
PUBLIC_API_URL=http://localhost:8787
```
```bash
pnpm --filter @dansum/web dev            # http://localhost:4321
```
홈(`/`), 카테고리(`/category/economy`), 상세(`/article/<id>`)가 실데이터로 렌더되는지 확인.

---

## 배포 (GitHub Actions)

main에 push되면 자동으로 배포된다. **수동 `wrangler deploy`는 하지 않는다** —
스키마와 코드가 따로 배포되면서 파이프라인이 죽는 사고가 있었다(아래 참고).

| 대상 | 배포 주체 |
| --- | --- |
| `dansum-web` | Cloudflare Pages (GitHub 연동, 자체 빌드) |
| D1 스키마 · `dansum-api` · `dansum-pipeline` | [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) |

`deploy.yml`은 **마이그레이션을 먼저 적용하고 그 다음에 워커를 올린다**. 순서가 핵심이다:
코드가 스키마보다 앞서면 collector의 INSERT가 D1_ERROR로 터지고, `runPipeline` 전체가
중단되어 수집·요약이 통째로 멈춘다(2026-07-27, `image_url` 컬럼 누락으로 2시간 중단).

### 필요한 GitHub Secrets
`Settings → Secrets and variables → Actions`:

| 이름 | 값 |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | Workers Scripts:Edit + D1:Edit + Account Settings:Read 권한 토큰 |
| `CLOUDFLARE_ACCOUNT_ID` | `wrangler whoami`의 Account ID |

### 스키마 변경 절차
1. `packages/db/migrations/NNNN_이름.sql` 추가 (번호는 이어서).
2. 로컬 검증: `cd apps/api && wrangler d1 migrations apply dansum-db --local --persist-to ../../.wrangler-state`
3. push → CI가 빈 DB에 전체 마이그레이션을 적용해 SQL을 검증하고, main이면 운영에 적용 후 워커 배포.

적용 이력은 `d1_migrations` 테이블이 관리한다. 기존 DB를 이 방식으로 처음 전환할 때만
[`packages/db/bootstrap_migrations_table.sql`](packages/db/bootstrap_migrations_table.sql)을 1회 실행한다.

### 시크릿(런타임)
`OPENAI_API_KEY`는 워커 시크릿이라 배포로 갱신되지 않는다:
`cd workers/collector && wrangler secret put OPENAI_API_KEY`
