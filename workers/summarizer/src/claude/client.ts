import { normalizeSections } from "@dansum/shared";
import { SYSTEM_PROMPT, buildUserPrompt, type SummaryResult } from "./prompts.js";

interface ChatMessage {
	role: "system" | "user" | "assistant";
	content: string;
}

interface OpenAIResponse {
	choices: Array<{
		message: { content: string | null };
		finish_reason: string | null;
	}>;
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
			// 섹션·중첩 불릿까지 담으려면 한국어 기준 2000~3000 토큰이 필요하다(실측 평균 약 1600).
			max_tokens: 4096,
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
	const choice = data.choices[0];
	const text = choice?.message.content;

	if (!text) {
		throw new Error("Empty response from OpenAI API");
	}

	// max_tokens에 걸려 잘린 JSON은 아래 JSON.parse에서 문법 오류로 튀어 원인이 가려진다.
	// 여기서 먼저 끊어 로그에 원인이 그대로 남게 한다(호출부가 재시도로 처리).
	if (choice.finish_reason === "length") {
		throw new Error("Summary truncated: hit max_tokens (raise max_tokens or shorten input)");
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

	// sections 방어: 형태가 어긋난 항목은 걸러냄(빈약한 본문이면 빈 배열).
	// API 조회 시점과 같은 규칙을 쓰도록 shared의 정규화 함수를 재사용한다.
	result.sections = normalizeSections(result.sections);

	return result;
}
