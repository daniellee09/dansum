import { SYSTEM_PROMPT, buildUserPrompt, type SummaryResult } from "./prompts.js";

interface ChatMessage {
	role: "system" | "user" | "assistant";
	content: string;
}

interface OpenAIResponse {
	choices: Array<{ message: { content: string | null } }>;
}

export async function summarizeArticle(
	article: {
		title: string;
		description: string | null;
		content: string | null;
		sourceName: string;
	},
	apiKey: string,
	model: string,
	// 기본은 OpenAI 직통. Cloudflare AI Gateway 등으로 우회하려면 호출부에서 주입.
	endpoint = "https://api.openai.com/v1/chat/completions",
): Promise<SummaryResult> {
	// API 키가 없으면 로컬 검증용 mock 결과 반환 (배포 시 키는 secret으로 항상 존재)
	if (!apiKey) {
		console.log(`[DEV MOCK] Summarizing without API key: ${article.title}`);
		const base = article.description || article.title;
		// 제목 앞 단어 일부를 키워드로 흉내(클러스터링 경로 검증용)
		const mockKeywords = article.title
			.split(/\s+/)
			.filter((w) => w.length >= 2)
			.slice(0, 4);
		return {
			title: article.title,
			summary: base.slice(0, 200),
			sections: [],
			key_points: [base.slice(0, 80) || article.title].filter(Boolean),
			category: "general",
			keywords: mockKeywords,
		};
	}

	const userMessage = buildUserPrompt(article);

	const response = await fetch(endpoint, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${apiKey}`,
		},
		body: JSON.stringify({
			model,
			max_tokens: 1536,
			// JSON 모드: 응답을 항상 유효한 JSON 객체로 강제 (system 프롬프트에 'JSON' 명시 필요)
			response_format: { type: "json_object" },
			messages: [
				{ role: "system", content: SYSTEM_PROMPT },
				{ role: "user", content: userMessage },
			] satisfies ChatMessage[],
		}),
	});

	if (!response.ok) {
		const errorText = await response.text();
		throw new Error(`OpenAI API error ${response.status}: ${errorText}`);
	}

	const data = (await response.json()) as OpenAIResponse;
	const text = data.choices[0]?.message.content;

	if (!text) {
		throw new Error("Empty response from OpenAI API");
	}

	// JSON 파싱 (json_object 모드라 보통 순수 JSON이지만 안전하게 코드블록도 제거)
	const jsonStr = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
	const result = JSON.parse(jsonStr) as SummaryResult;

	// 기본 유효성 검증
	if (!result.title || !result.summary || !Array.isArray(result.key_points)) {
		throw new Error("Invalid summary result structure");
	}

	// keywords 누락 시 빈 배열로 보정(클러스터링에서 단독 클러스터가 됨)
	if (!Array.isArray(result.keywords)) {
		result.keywords = [];
	}

	// sections 방어: 배열이 아니거나 형태가 어긋난 항목은 걸러냄(빈약한 본문이면 빈 배열)
	result.sections = Array.isArray(result.sections)
		? result.sections
				.filter(
					(s) =>
						s &&
						typeof s.heading === "string" &&
						Array.isArray(s.points),
				)
				.map((s) => ({
					heading: s.heading,
					points: s.points.filter((p): p is string => typeof p === "string"),
				}))
				.filter((s) => s.heading.trim() !== "" && s.points.length > 0)
		: [];

	return result;
}
