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
 * '상투어'(연결자로 쓰면 안 되는 흔한 말) 판정 기준.
 *
 * 왜 필요한가: 키워드 동결(ISSUE_MATCH_KEYWORD_MAX)은 이슈가 무한히 커지는 것을 막지만,
 * 상투어가 '연결자'로 쓰이는 것은 못 막는다. 운영 데이터에서 "2분기실적"이 72시간에 191번,
 * "조정ebitda"가 44번 나온다. MIN_SHARED_KEYWORDS=2에서는 이 둘만 겹쳐도 식스플래그스와
 * Warrior Met Coal이 한 이슈가 된다(실제로 그렇게 묶였다).
 *
 * 왜 MIN_SHARED_KEYWORDS를 3으로 올리지 않았나: 더 단순하지만 같은 데이터에서 교차매체
 * 이슈가 26개 → 3개로 무너진다. "여러 매체가 함께 보도한 이슈"가 제품의 핵심인데 그걸
 * 죽이는 처방이다.
 *
 * 왜 '이슈 수'가 아니라 '기사 수'로 세나: 이슈 기준으로 세면 상투어가 여러 이슈에 퍼지지
 * 않고 한 이슈에 몰려버려 빈도가 임계값에 닿지 않는다(실제로 운영에서 그래서 안 먹었다).
 * 기사 기준으로 세면 상투어는 정의상 반드시 흔하다.
 *
 * 운영 데이터 1,173건을 실제 드레인 경로(200건 배치)로 재현한 결과:
 *   필터 없음      최대 21건 | 교차매체 25 | 홈창 교차매체 21
 *   이슈 수 기준    최대 12건 | 교차매체 26 | 홈창 교차매체 22
 *   기사 수 기준    최대  6건 | 교차매체 27 | 홈창 교차매체 24   ← 모든 지표에서 우월
 */
export const COMMON_KEYWORD_MIN_COUNT = 5;
/** 배치가 클수록 절대 개수 기준은 느슨해지므로 비율도 함께 본다(둘 중 큰 값이 임계값). */
export const COMMON_KEYWORD_BATCH_RATIO = 0.03;

/**
 * '흔한 말'의 집합을 만든다.
 *
 * 표본(samples)에는 배치의 기사 키워드와 열린 이슈의 매칭 키워드를 함께 넣지만, 임계값은
 * **기사 수(thresholdBase)로만** 정한다. 둘을 합친 크기로 비율을 잡으면 열린 이슈가 400개
 * 딸려오는 순간 임계값이 6 → 18로 뛰어 필터가 사실상 꺼진다(운영에서 실제로 그랬다:
 * 최대 이슈가 43건까지 커졌다).
 *
 * 임계값에 못 미치는 작은 배치(cron의 10건)에서는 거의 아무것도 걸리지 않는데, 그래도 된다
 * — 작은 배치는 애초에 블롭을 만들지 않는다.
 */
export function findCommonKeywords(samples: Set<string>[], thresholdBase: number): Set<string> {
	const df = new Map<string, number>();
	for (const set of samples) {
		for (const k of set) df.set(k, (df.get(k) ?? 0) + 1);
	}
	const threshold = Math.max(
		COMMON_KEYWORD_MIN_COUNT,
		Math.ceil(thresholdBase * COMMON_KEYWORD_BATCH_RATIO),
	);
	const common = new Set<string>();
	for (const [k, n] of df) {
		if (n >= threshold) common.add(k);
	}
	return common;
}

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
