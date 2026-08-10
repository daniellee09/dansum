-- 키워드 알림 수신 여부.
--
-- follows 테이블에는 마이그레이션이 필요 없다 — target_type은 CHECK 없는 자유 텍스트이고
-- PK가 (user_id, target_type, target_value) 복합키라 'keyword'가 그대로 들어간다.
--
-- notify_reply(답글 알림 끄기)는 만들지 않는다. 답글 알림은 계속 돌고 있고 불만이 없었다.
-- 필요 없는 토글 하나는 마이그레이션 하나이자 영원히 유지해야 할 UI 상태 하나다.
ALTER TABLE users ADD COLUMN notify_keyword INTEGER NOT NULL DEFAULT 1;
