/**
 * 등록 직전에 한 번 되묻기 위한 표현 감지. **거울이지 관문이 아니다.**
 *
 * 왜 packages/shared가 아니라 여기 있나:
 *   shared는 서버가 쓸 때 가는 곳이다. 거기에 두면 언젠가 누군가 POST 핸들러에 붙여
 *   '차단'으로 만든다 — 이 기능의 의도와 정반대다. 클라이언트 전용으로 묶어두면
 *   "막지 않는다"가 관례가 아니라 구조가 된다.
 *
 * 우회는 아주 쉽다(자모 분리, 초성, 오타). **그래도 괜찮다.** 목적은 필터링이 아니라
 * 홧김에 쓴 사람에게 1초를 돌려주는 것이다. 우회를 막으려고 패턴을 늘리는 군비경쟁은
 * 하지 말 것 — 오탐만 늘고 잔소리로 읽힌다.
 *
 * 이 목록은 번들에 실려 공개된다. 인용돼도 부끄럽지 않을 것만 넣는다.
 */

export interface ToneRule {
	key: "labeling" | "personal" | "generalizing";
	/** 지적이 아니라 '되묻는 질문'이어야 한다. 훈계로 읽히면 반발만 산다. */
	question: string;
	patterns: RegExp[];
}

export const TONE_RULES: ToneRule[] = [
	{
		key: "labeling",
		question: "상대를 진영 이름으로 부르고 있진 않나요? 라벨보다 근거가 더 잘 전달돼요.",
		patterns: [
			/좌빨|우꼴|수꼴|빨갱이|토착왜구|친일파냐/,
			/대깨\S*/,
			/틀딱|급식충|한남충|김치녀|맘충/,
			/\S{1,4}충(들|이|은|의|아)?(?![가-힣])/,
		],
	},
	{
		key: "personal",
		question: "이 표현이 주장이 아니라 사람을 향하고 있진 않나요?",
		patterns: [/멍청|무식|병신|등신|찌질|한심하네|꺼져|닥쳐|주제에|수준하고는/],
	},
	{
		key: "generalizing",
		question: "특정 집단 전체를 하나로 묶고 있진 않나요?",
		patterns: [/역시\S*들은/, /\S+들은다똑같/, /하여간\S*들은/],
	},
];

/**
 * 걸린 첫 규칙 하나만 돌려준다 — 여러 개를 나열하면 훈계처럼 읽힌다.
 * 공백을 지우고 비교하는 건 "좌 빨" 같은 가벼운 띄어쓰기 우회까지만 잡으려는 것이다.
 */
export function detectTone(text: string): ToneRule | null {
	const normalized = text.replace(/\s/g, "");
	if (!normalized) return null;
	for (const rule of TONE_RULES) {
		if (rule.patterns.some((p) => p.test(normalized))) return rule;
	}
	return null;
}
