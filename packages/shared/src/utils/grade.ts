export interface Grade {
	key: "gold" | "silver" | "bronze" | "newbie";
	label: string;
	minKarma: number;
}

/** 카르마 임계값으로 등급을 계산하는 순수 함수 — 별도 테이블 없이 users.karma만으로 판단한다.
 *  높은 임계값부터 확인해 처음 만족하는 등급을 반환한다. */
const GRADES: Grade[] = [
	{ key: "gold", label: "골드", minKarma: 100 },
	{ key: "silver", label: "실버", minKarma: 50 },
	{ key: "bronze", label: "브론즈", minKarma: 10 },
	{ key: "newbie", label: "뉴비", minKarma: 0 },
];

export function getGrade(karma: number): Grade {
	return GRADES.find((g) => karma >= g.minKarma) ?? GRADES[GRADES.length - 1];
}
