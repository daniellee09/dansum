export function formatKoreanDate(dateStr: string): string {
	const date = new Date(dateStr);
	return new Intl.DateTimeFormat("ko-KR", {
		year: "numeric",
		month: "long",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	}).format(date);
}

export function formatRelativeTime(dateStr: string): string {
	const now = Date.now();
	const date = new Date(dateStr).getTime();
	const diffMs = now - date;
	const diffMin = Math.floor(diffMs / 60000);
	const diffHour = Math.floor(diffMs / 3600000);
	const diffDay = Math.floor(diffMs / 86400000);

	if (diffMin < 1) return "방금 전";
	if (diffMin < 60) return `${diffMin}분 전`;
	if (diffHour < 24) return `${diffHour}시간 전`;
	if (diffDay < 7) return `${diffDay}일 전`;
	return formatKoreanDate(dateStr);
}

export function toISOString(): string {
	return new Date().toISOString();
}
