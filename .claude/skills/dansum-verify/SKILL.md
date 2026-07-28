---
name: dansum-verify
description: Verify a Dansum code change before calling it done — bundle/build checks (mirrors CI) plus a Playwright browser smoke test of the web app's core flows (sort tabs on lists and search, bookmarks, follow/feed, Hot!). Use after editing apps/web or apps/api, instead of re-deriving build/test commands from scratch each time.
---

# Dansum 빌드·스모크 테스트 검증

코드를 고칠 때마다 CI 명령을 다시 찾아보거나 브라우저 테스트 스크립트를 새로 짜지 않도록,
반복되는 검증 절차를 여기 고정해 둔다. 로컬 dev 서버 기동/D1 시드는 `dansum-dev` 스킬을 본다.

## 1. 빌드·번들 검증 (CI와 동일, `.github/workflows/ci.yml` 참고)

```bash
# 웹: 타입·임포트·템플릿 오류를 여기서 잡는다
pnpm --filter @dansum/web build

# API 워커: 자격증명 없이 번들만 만들어본다(배포 안 함)
cd apps/api && pnpm exec wrangler deploy --dry-run --outdir /tmp/bundle-api

# 파이프라인 워커(collector)
cd workers/collector && pnpm exec wrangler deploy --dry-run --outdir /tmp/bundle-pipeline
```

주의: `apps/api`, `workers/*`는 `@cloudflare/workers-types`가 devDependency로 선언돼 있지 않아
`tsc --noEmit`은 항상 타입 정의를 못 찾고 실패한다(레포에 원래 있던 상태, 새로 생긴 문제 아님).
그래서 타입 체크는 `tsc`가 아니라 위 `wrangler deploy --dry-run`(esbuild 번들링)으로 한다.

## 2. 브라우저 스모크 테스트

전제: 로컬 web(4321)·api(8787) dev 서버가 떠 있어야 한다(`dansum-dev` 스킬로 기동).

```bash
pnpm --filter @dansum/web test:smoke
```

`apps/web/scripts/smoke-test.mjs`가 headless Chromium으로 다음을 확인한다: 홈 목록 렌더,
정렬 탭(`?sort=hot`), 사이드바 Hot!→`/hot`(24시간 내 보도량 상위 50, 캐시 없음), 검색 정렬
(기본 관련도순 + `sort=latest`/`sort=hot`), 북마크 토글→`/bookmarks` 반영→해제, 매체 팔로우→
`/feed` 반영.
기능이 늘어나면 이 파일에 체크를 추가해서 회귀 스위트로 키운다(새 스크립트를 매번 새로 만들지 말 것).

- `SMOKE_BASE_URL` 환경변수로 대상 origin을 바꿀 수 있다. **반드시 `http://localhost:4321`을
  써야 한다** — `127.0.0.1:4321`로 접속하면 `apps/api/src/index.ts`의 CORS allow-list(`localhost`만
  허용)에 막혀 북마크·피드처럼 브라우저에서 API를 직접 호출하는 기능이 전부 실패한다(실제 버그
  아니라 접속 주소 문제이니 착각하지 말 것).
- Playwright는 `apps/web`의 devDependency로 있다. Chromium 바이너리가 없으면 최초 1회만:
  `npx playwright install chromium`.

## 3. 결과 판단

두 단계 모두 exit code 0이어야 통과. `wrangler dry-run`은 바인딩 요약을 출력하고 끝나면 성공,
스모크 테스트는 마지막 줄에 `N/N checks passed`가 나오고 실패 항목은 `FAIL -`로 표시된다.
