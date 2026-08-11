/**
 * 같은 사건을 다룬 기사들을 묶는 규칙. 예전에는 apps/api의 읽기 경로 안에만 있었지만,
 * 이슈에 영속 식별자가 생기면서(migrations/0010) 수집 시점에 묶는 컬렉터도 같은 규칙을
 * 써야 한다. 규칙이 두 벌이 되면 조용히 갈라지므로 여기 한 곳에만 둔다.
 */

/** 키워드 정규화: 공백·구두점 제거 + 소문자화(한글은 영향 없음) */
export function normalizeKeyword(k: string): string {
	return k
		.trim()
		.toLowerCase()
		.replace(/[\s·().,"'“”\-_/]/g, "");
}

/** 두 정규화 키워드 집합의 공통 원소. 개수만이 아니라 '무엇이' 겹쳤는지도 판정에 쓴다
 *  (아래 COMMON_KEYWORD_ISSUE_COUNT 참고). */
export function sharedKeywords(a: Set<string>, b: Set<string>): string[] {
	const out: string[] = [];
	for (const k of a) {
		if (b.has(k)) out.push(k);
	}
	return out;
}

/** 같은 사건으로 보려면 최소 이만큼의 키워드를 공유해야 한다. */
export const MIN_SHARED_KEYWORDS = 2;

/**
 * 이 개수 이상의 서로 다른 이슈가 매칭 집합에 갖고 있는 키워드는 '상투어'로 본다.
 * 상투어만으로는 두 기사를 잇지 못한다 — 공유 키워드 중 최소 하나는 드문 말이어야 한다.
 *
 * 왜 필요한가: 키워드 동결(ISSUE_MATCH_KEYWORD_MAX)은 이슈가 무한히 커지는 것을 막지만,
 * 상투어가 '연결자'로 쓰이는 것은 못 막는다. 운영 데이터에서 "2분기실적"이 72시간에 191번,
 * "조정ebitda"가 44번 나온다. MIN_SHARED_KEYWORDS=2에서는 이 둘만 겹쳐도 식스플래그스와
 * Warrior Met Coal이 한 이슈가 된다(실제로 그렇게 묶였다).
 *
 * 임계값을 왜 이 방향으로 풀었나: MIN_SHARED_KEYWORDS를 3으로 올리는 게 더 단순하지만,
 * 같은 데이터에서 교차매체 이슈가 26개 → 3개로 무너진다. "여러 매체가 함께 보도한 이슈"가
 * 제품의 핵심인데 그걸 죽이는 셈이다. 이 필터는 교차매체 26 → 24만 잃으면서 최대 이슈를
 * 27건 → 14건으로 줄이고, 홈 화면(30시간 창)에는 아무 변화도 주지 않는다.
 *
 * 빈도는 별도 테이블이나 추가 조회 없이, 이미 로드한 열린 이슈들의 match_keywords에서 센다.
 */
export const COMMON_KEYWORD_ISSUE_COUNT = 6;

/**
 * 이슈 하나가 보관하는 매칭 키워드 상한. LLM이 기사당 3~6개를 뽑으므로 8이면 넉넉하다.
 * 이 집합은 **창설 기사에서 뽑아 동결**하며 새 멤버의 키워드를 합집합으로 더하지 않는다.
 *
 * 합집합으로 키우면: {연준,기준금리,동결} → 물가 기사를 흡수하며 {소비자물가,물가상승률}
 * → 증시 반응 기사를 흡수하며 {코스피,환율} … 며칠이면 이슈 하나가 피드 대부분을 소유한다.
 * (읽기 시점 클러스터링은 30시간 창이 매일 리셋해줘서 이 문제가 가려져 있었을 뿐이다.)
 * 대가로 "연준"과 "미연준"이 안 이어져 이슈가 둘로 갈리는 경우가 생긴다 — 받아들인다.
 * 이슈 둘은 사소한 실망이고, 사이트를 먹어치운 이슈 하나는 장애다.
 */
export const ISSUE_MATCH_KEYWORD_MAX = 8;

/**
 * 흡수 창(시간). 마지막 기사로부터 이만큼 지난 이슈는 더 이상 새 기사를 흡수하지 않는다.
 * apps/api의 읽기 창(CANDIDATE_WINDOW_HOURS=30)보다 길게 둬서, 홈에 떠 있는 이슈가
 * 흡수를 못 하는 구간이 생기지 않게 한다. "닫힘"은 컬럼이 아니라 이 쿼리 조건이다
 * (cron도, 낡을 수 있는 상태도 만들지 않는다).
 */
export const ISSUE_ABSORB_WINDOW_HOURS = 36;

/** 기사 키워드 → 정규화된 집합(빈 문자열 제거). */
export function toKeywordSet(keywords: string[]): Set<string> {
	return new Set(keywords.map(normalizeKeyword).filter(Boolean));
}
