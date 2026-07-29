/** 유저 아바타(업로드 없이 이니셜+색상). SourceIcon의 해시 팔레트 방식과 같은 아이디어. */

const PALETTE = ["#b92b27", "#2e69ff", "#0f7b6c", "#a1601a", "#6b21a8", "#0e7490"];

export function getInitialAvatar(seed: string, name: string): { initial: string; color: string } {
	let hash = 0;
	for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
	return {
		initial: (name.trim()[0] ?? "?").toUpperCase(),
		color: PALETTE[hash % PALETTE.length],
	};
}
