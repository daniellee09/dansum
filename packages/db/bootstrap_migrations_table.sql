-- wrangler 마이그레이션 추적 테이블 부트스트랩 (기존 DB에 1회만 실행)
--
-- 이 프로젝트는 초기에 마이그레이션 파일을 `d1 execute --file`로 직접 실행해 왔기 때문에
-- wrangler가 "무엇이 적용됐는지" 알 수 없다. 그 상태로 `d1 migrations apply`를 돌리면
-- 0001(CREATE TABLE)부터 다시 실행해 실패한다. 그래서 이미 적용된 마이그레이션을
-- 추적 테이블에 미리 등록해 둔다. 이후로는 CI가 `d1 migrations apply`로만 스키마를 바꾼다.
--
-- 실행(운영):
--   npx wrangler d1 execute dansum-db --remote --config apps/api/wrangler.toml \
--     --file packages/db/bootstrap_migrations_table.sql
-- 실행(로컬):
--   위 명령에서 --remote 를 `--local --persist-to .wrangler-state` 로 교체
--
-- 새로 만든 빈 DB에는 실행할 필요가 없다(`d1 migrations apply`가 처음부터 다 적용).

-- 테이블 정의는 wrangler가 만드는 것과 동일해야 한다.
CREATE TABLE IF NOT EXISTS d1_migrations(
	id         INTEGER PRIMARY KEY AUTOINCREMENT,
	name       TEXT UNIQUE,
	applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- 0001·0002는 운영/로컬 모두 이미 적용된 상태다.
INSERT OR IGNORE INTO d1_migrations (name) VALUES
	('0001_initial_schema.sql'),
	('0002_add_sections.sql');

-- 0003은 DB마다 다르다(로컬=적용됨, 운영=미적용). 실제 컬럼 존재 여부로 판단해
-- 이미 적용된 DB에서만 등록한다. 미적용 DB에서는 등록되지 않아 CI가 정상적으로 적용한다.
INSERT OR IGNORE INTO d1_migrations (name)
SELECT '0003_add_image_url.sql'
WHERE EXISTS (SELECT 1 FROM pragma_table_info('articles') WHERE name = 'image_url');
