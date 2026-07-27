/** 출처 아바타(레딧식 서브레딧 아이콘)에 쓰는 표시 정보 */
export interface SourceMeta {
	/** 파비콘 조회용 도메인 (원문 URL에서 추출, 실패 시 빈 문자열) */
	domain: string;
	/** 파비콘을 못 불러올 때 원 안에 표시할 글자 */
	initial: string;
	/** 아바타 배경색 */
	color: string;
	/** 파비콘 URL (domain이 없으면 빈 문자열) */
	iconUrl: string;
}

/** 알려진 매체의 브랜드 색. 없으면 sourceId 해시로 팔레트에서 고름 */
const BRAND_COLORS: Record<string, string> = {
	"yonhap-economy": "#0b57a4",
	"hankyung-economy": "#003f7f",
	"mk-economy": "#e60012",
	sedaily: "#d6202e",
	"cnbc-economy": "#005594",
	"cnbc-finance": "#005594",
	"npr-business": "#d63b2f",
	"fed-press": "#1a3d6d",
	"marketwatch-top": "#00a800",
	"yahoo-finance": "#6001d2",
};

const FALLBACK_PALETTE = [
	"#b92b27",
	"#2e69ff",
	"#0f7b6c",
	"#a1601a",
	"#6b21a8",
	"#0e7490",
];

function pickFallbackColor(seed: string): string {
	let hash = 0;
	for (let i = 0; i < seed.length; i++) {
		hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
	}
	return FALLBACK_PALETTE[hash % FALLBACK_PALETTE.length];
}

function extractDomain(sourceUrl: string): string {
	try {
		return new URL(sourceUrl).hostname.replace(/^www\./, "");
	} catch {
		return "";
	}
}

export function getSourceMeta(
	sourceId: string,
	sourceUrl: string,
	sourceName: string,
): SourceMeta {
	const domain = extractDomain(sourceUrl);
	return {
		domain,
		initial: (sourceName.trim()[0] ?? "?").toUpperCase(),
		color: BRAND_COLORS[sourceId] ?? pickFallbackColor(sourceId),
		// DuckDuckGo 파비콘 프록시(구글 대비 추적 부담이 적음). 실패하면 initial 폴백이 드러난다.
		iconUrl: domain ? `https://icons.duckduckgo.com/ip3/${domain}.ico` : "",
	};
}
