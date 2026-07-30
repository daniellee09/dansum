/**
 * 경험치 → 레벨 → 등급. 테이블 없이 순수 함수로만 계산한다(users.exp 하나만 저장하면 된다).
 *
 * 누적 경험치 공식: level L에 도달하려면 5·L·(L−1)
 *   Lv.2 = 10 · Lv.5 = 100 · Lv.10 = 450 · Lv.20 = 1,900 · Lv.50 = 12,250
 * 초반을 촘촘하게 둬서 가입 직후에도 레벨이 오르는 게 보이도록 했다(추천 한 번이면 Lv.2).
 */

export const MAX_LEVEL = 50;

export interface Grade {
	key: "beginner" | "observer" | "analyst" | "strategist" | "visionary";
	label: string;
	/** 이 등급이 시작되는 레벨 */
	minLevel: number;
}

/** 낮은 등급 → 높은 등급. 뒤로 갈수록 구간을 넓게 둬서 상위 등급의 희소성을 유지한다. */
export const GRADES: Grade[] = [
	{ key: "beginner", label: "초심자", minLevel: 1 },
	{ key: "observer", label: "관찰자", minLevel: 5 },
	{ key: "analyst", label: "분석가", minLevel: 15 },
	{ key: "strategist", label: "전략가", minLevel: 30 },
	{ key: "visionary", label: "통찰가", minLevel: 45 },
];

/** 해당 레벨에 도달하는 데 필요한 누적 경험치 */
export function expForLevel(level: number): number {
	const clamped = Math.max(1, Math.min(MAX_LEVEL, Math.floor(level)));
	return 5 * clamped * (clamped - 1);
}

/** 누적 경험치로 현재 레벨을 구한다(위 공식의 역함수). MAX_LEVEL에서 멈춘다. */
export function getLevel(exp: number): number {
	if (!Number.isFinite(exp) || exp <= 0) return 1;
	const level = Math.floor((1 + Math.sqrt(1 + (4 * exp) / 5)) / 2);
	return Math.max(1, Math.min(MAX_LEVEL, level));
}

export function getGradeByLevel(level: number): Grade {
	let current = GRADES[0];
	for (const grade of GRADES) {
		if (level >= grade.minLevel) current = grade;
	}
	return current;
}

export function getGrade(exp: number): Grade {
	return getGradeByLevel(getLevel(exp));
}

export interface LevelProgress {
	level: number;
	grade: Grade;
	/** 만렙이면 true — 이때 진행률은 100%로 고정된다 */
	isMax: boolean;
	/** 현재 레벨 구간에서 얼마나 왔는지(0~100) */
	percent: number;
	/** 다음 레벨까지 남은 경험치. 만렙이면 0 */
	expToNext: number;
}

/** 마이페이지 진행 바에 필요한 값을 한 번에 계산한다. */
export function getLevelProgress(exp: number): LevelProgress {
	const level = getLevel(exp);
	const grade = getGradeByLevel(level);
	if (level >= MAX_LEVEL) {
		return { level, grade, isMax: true, percent: 100, expToNext: 0 };
	}
	const start = expForLevel(level);
	const next = expForLevel(level + 1);
	const span = next - start;
	const gained = Math.max(0, exp - start);
	return {
		level,
		grade,
		isMax: false,
		percent: Math.min(100, Math.round((gained / span) * 100)),
		expToNext: Math.max(0, next - exp),
	};
}
