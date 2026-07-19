---
name: dansum-dev
description: Run and verify the Dansum local pipeline (collector → fetcher → summarizer → API → web) on Miniflare. Use when starting Dansum dev servers, applying D1 migrations/seed locally, triggering collection/fetch/summarize, resetting articles to re-test, or inspecting the local D1.
---

# Dansum 로컬 파이프라인 실행/검증

단숨은 pnpm 모노레포 + Cloudflare Workers다. 모든 워커가 **하나의 공유 로컬 상태**를 쓰도록
항상 동일한 `--persist-to e:/Dansum/.wrangler-state` 를 모든 wrangler 명령(d1 execute 포함)에 준다.

## 핵심 함정 (반드시 지킬 것)
- **공유 상태**: 워커별 `wrangler dev`는 기본적으로 로컬 D1/KV/Queue가 분리된다. 같은 데이터를 쓰려면
  모든 명령에 동일한 `--persist-to e:/Dansum/.wrangler-state`.
- **wrangler 호출**: 워크스페이스에 wrangler 미설치 → `npx --yes wrangler@4.100.0` 사용.
- **apps/api(및 간헐적으로 다른 워커)에서 `npx wrangler`가 바이너리를 못 찾는 경우**가 있다(exit 127/1).
  → **루트에서 `--config <경로>/wrangler.toml`로 실행**하면 안정적:
  `cd e:/Dansum && npx --yes wrangler@4.100.0 dev --config <worker>/wrangler.toml --persist-to .wrangler-state --port <P> --ip 127.0.0.1`
- **dev 엔드포인트**(큐 프로세스간 전달에 의존하지 않는 로컬 검증용):
  collector `GET /trigger`(수집), fetcher `GET /process`(본문 추출), summarizer `GET /process`(요약, pending 50건씩).
- **OpenAI 키**: `workers/summarizer/.dev.vars` 의 `OPENAI_API_KEY`. 없으면 summarizer가 `[DEV MOCK]` 요약 반환.
- dev 서버는 `run_in_background`로 띄우고, `curl`로 `GET /` 200을 폴링해 준비됐는지 확인 후 트리거.
- 종료: 백그라운드 task를 TaskStop으로 정리.

## 포트 컨벤션
collector 8788 · summarizer 8789 · fetcher 8790 · api 8787 · web 4321

## D1 (로컬) 명령
```bash
DB="dansum-db"; ST="e:/Dansum/.wrangler-state"
WR="npx --yes wrangler@4.100.0"
# 초기화
$WR d1 execute $DB --local --persist-to $ST -y --file=e:/Dansum/packages/db/migrations/0001_initial_schema.sql
$WR d1 execute $DB --local --persist-to $ST -y --file=e:/Dansum/packages/db/seed/sources.sql
# 조회/임의 SQL
$WR d1 execute $DB --local --persist-to $ST -y --command "SELECT status, count(*) FROM raw_articles GROUP BY status"
```
- JSON 출력이 필요하면 `--json` + `PYTHONIOENCODING=utf-8 python -c ...` (cp949 인코딩 에러 회피).

## 전체 E2E 순서
1. (최초 1회) 위 D1 초기화 + 시드.
2. collector dev 기동 → `curl http://127.0.0.1:8788/trigger` → `raw_articles` 적재 확인. 재호출 시 총건수 유지면 dedup OK.
3. fetcher dev 기동 → `curl http://127.0.0.1:8790/process` → `SELECT count(*) FROM raw_articles WHERE content IS NOT NULL` 로 본문 채움 확인.
4. summarizer dev 기동(키 .dev.vars) → `curl http://127.0.0.1:8789/process` 를 pending 0 될 때까지 → `articles` 채움 확인.
5. api dev 기동 → `curl "http://127.0.0.1:8787/api/articles?pageSize=2"`, `/api/categories`, `/api/articles/<id>`.
6. web: `apps/web/.env`에 `PUBLIC_API_URL=http://localhost:8787` → `pnpm --filter @dansum/web dev` → 홈/카테고리/상세 렌더.

## 실제 요약을 다시 테스트하려고 N건을 pending으로 리셋
```bash
DB="dansum-db"; ST="e:/Dansum/.wrangler-state"; WR="npx --yes wrangler@4.100.0"
# 본문/설명 있는 N건 리셋 + 기존 articles row 제거(중복 방지)
$WR d1 execute $DB --local --persist-to $ST -y --command \
 "UPDATE raw_articles SET status='pending', retry_count=0 WHERE id IN (SELECT id FROM raw_articles WHERE description IS NOT NULL ORDER BY created_at LIMIT 5)"
$WR d1 execute $DB --local --persist-to $ST -y --command \
 "DELETE FROM articles WHERE raw_article_id IN (SELECT id FROM raw_articles WHERE status='pending')"
```

상세 배경: 프로젝트 루트 `RUNBOOK.md`, 설계 `docs/content-crawler-design.md`.
