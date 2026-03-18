import { NextResponse } from "next/server";
import OpenAI from "openai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

type SourceType = "url" | "text";
type ExtractionConfidence = "높음" | "중간" | "낮음";
type RiskLevel = "낮음" | "중간" | "높음";
type ClickbaitLevel = "낮음" | "주의" | "높음";
type CrossCheckStatus = "일치" | "일부 일치" | "불일치";

type CrossCheckItem = {
  source: string;
  status: CrossCheckStatus;
  note: string;
};

type ScoreBreakdown = {
  sourceReliability: number;
  primarySource: number;
  crossVerification: number;
  sensationalism: number;
  evidenceQuality: number;
};

type AnalysisPayload = {
  summary: string;
  verdict: string;
  confirmedFacts: string[];
  uncertainFacts: string[];
  issues: string[];
  crossChecks: CrossCheckItem[];
  scoreBreakdown: ScoreBreakdown;
};

function clamp(n: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Math.round(n)));
}

function normalizeWhitespace(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

function cleanLines(text: string) {
  return text
    .split("\n")
    .map((line) => normalizeWhitespace(line))
    .filter(Boolean)
    .join("\n");
}

function isValidUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function getDomain(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function isWrapperDomain(domain: string) {
  return [
    "msn.com",
    "naver.com",
    "news.naver.com",
    "daum.net",
    "v.daum.net",
  ].some((d) => domain === d || domain.endsWith(`.${d}`));
}

function sanitizeModelJson(raw: string) {
  return raw
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
}

function safeJsonParse<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function normalizeStringArray(value: unknown, max = 5): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, max);
}

function normalizeCrossChecks(value: unknown, max = 5): CrossCheckItem[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;

      const source =
        typeof (item as Record<string, unknown>).source === "string"
          ? ((item as Record<string, unknown>).source as string).trim()
          : "";

      const rawStatus = (item as Record<string, unknown>).status;
      const status: CrossCheckStatus =
        rawStatus === "일치" || rawStatus === "일부 일치" || rawStatus === "불일치"
          ? rawStatus
          : "일부 일치";

      const note =
        typeof (item as Record<string, unknown>).note === "string"
          ? ((item as Record<string, unknown>).note as string).trim()
          : "";

      if (!source || !note) return null;
      return { source, status, note };
    })
    .filter((item): item is CrossCheckItem => Boolean(item))
    .slice(0, max);
}

function normalizeScoreBreakdown(value: unknown): ScoreBreakdown {
  const v = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;

  return {
    sourceReliability: clampNumber(v.sourceReliability, -20, 20),
    primarySource: clampNumber(v.primarySource, -20, 20),
    crossVerification: clampNumber(v.crossVerification, -15, 15),
    sensationalism: clampNumber(v.sensationalism, -20, 0),
    evidenceQuality: clampNumber(v.evidenceQuality, -25, 15),
  };
}

function clampNumber(value: unknown, min: number, max: number) {
  const n = typeof value === "number" ? value : Number(value ?? 0);
  if (Number.isNaN(n)) return 0;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function tokenizeKoreanish(text: string) {
  return Array.from(
    new Set(
      (text.match(/[가-힣A-Za-z0-9]{2,}/g) || [])
        .map((t) => t.trim())
        .filter((t) => t.length >= 2)
    )
  );
}

function titleBodyOverlapScore(title: string, body: string) {
  const titleTokens = tokenizeKoreanish(title).slice(0, 15);
  if (titleTokens.length === 0) return 0;

  const hit = titleTokens.filter((token) => body.includes(token)).length;
  return clamp((hit / titleTokens.length) * 100);
}

function countBadSignals(text: string) {
  const badWords = [
    "관련 기사",
    "더보기",
    "광고",
    "구독",
    "로그인",
    "댓글",
    "추천",
    "공유",
    "저작권자",
    "기사제보",
    "무단전재",
  ];

  return badWords.filter((word) => text.includes(word)).length;
}

function scoreExtractedTextQuality(text: string) {
  const normalized = normalizeWhitespace(text);
  const len = normalized.length;
  const badSignalCount = countBadSignals(normalized);

  let score = 0;

  if (len >= 400) score += 20;
  if (len >= 800) score += 20;
  if (len >= 1400) score += 20;
  if (len >= 2500) score += 10;

  if (badSignalCount === 0) score += 20;
  if (badSignalCount === 1) score += 10;
  if (badSignalCount >= 3) score -= 20;

  const sentenceCount = normalized
    .split(/[.!?。！？]\s|다\.\s|요\.\s/)
    .filter(Boolean).length;

  if (sentenceCount >= 5) score += 10;
  if (sentenceCount >= 10) score += 10;

  return clamp(score);
}

function detectExaggeration(text: string) {
  const keywords = [
    "충격",
    "경악",
    "대참사",
    "소름",
    "역대급",
    "미쳤다",
    "난리",
    "초비상",
    "긴급",
    "폭발",
    "완전 망",
    "경악할",
    "충격적",
    "발칵",
    "초토화",
    "멘붕",
    "충격 고백",
    "아수라장",
    "대혼란",
    "믿을 수 없는",
    "소름 돋는",
    "단독",
    "결국",
    "실화냐",
    "경악스런",
  ];

  const found = Array.from(new Set(keywords.filter((keyword) => text.includes(keyword))));

  return {
    count: found.length,
    words: found.slice(0, 8),
  };
}

function calculateClickbaitScore(params: {
  exaggerationCount: number;
  sensationalism: number;
  evidenceQuality: number;
  primarySource: number;
  sourceReliability: number;
  issues: string[];
}) {
  let score = 0;

  score += Math.min(params.exaggerationCount * 16, 40);
  score += Math.max(-params.sensationalism * 2, 0);
  score += Math.max(-params.evidenceQuality * 1.5, 0);
  score += Math.max(-params.primarySource * 1.2, 0);
  score += Math.max(-params.sourceReliability, 0);

  const suspiciousIssueHits = params.issues.filter((issue) =>
    ["과장", "출처", "검증", "근거", "불명확", "자극", "제목"].some((keyword) =>
      issue.includes(keyword)
    )
  ).length;

  score += suspiciousIssueHits * 6;

  return clamp(score);
}

function getRiskLevel(score: number): RiskLevel {
  if (score >= 70) return "낮음";
  if (score >= 40) return "중간";
  return "높음";
}

function getClickbaitLevel(score: number): ClickbaitLevel {
  if (score >= 70) return "높음";
  if (score >= 40) return "주의";
  return "낮음";
}

function buildClickbaitReasons(params: {
  exaggerationCount: number;
  sensationalism: number;
  evidenceQuality: number;
  primarySource: number;
  sourceReliability: number;
}) {
  const reasons: string[] = [];

  if (params.exaggerationCount >= 2) reasons.push("자극적 표현 다수 감지");
  if (params.sensationalism <= -10) reasons.push("과장성 감점 큼");
  if (params.evidenceQuality <= -10) reasons.push("근거 수준 낮음");
  if (params.primarySource < 0) reasons.push("1차 출처 부족");
  if (params.sourceReliability < 0) reasons.push("출처 신뢰도 낮음");

  if (reasons.length === 0) reasons.push("낚시성 징후가 두드러지지 않음");

  return reasons.slice(0, 4);
}

async function extractArticleText(input: string): Promise<{
  extractedText: string;
  extractionUsed: boolean;
  extractionWarning: string;
  extractionConfidence: ExtractionConfidence;
  extractionReliable: boolean;
  sourceType: SourceType;
  sourceDomain: string;
  extractedTitle: string;
  extractor: string;
}> {
  const trimmed = input.trim();

  if (!isValidUrl(trimmed)) {
    return {
      extractedText: trimmed,
      extractionUsed: false,
      extractionWarning: "",
      extractionConfidence: "높음",
      extractionReliable: true,
      sourceType: "text",
      sourceDomain: "",
      extractedTitle: "",
      extractor: "user_text",
    };
  }

  const sourceDomain = getDomain(trimmed);

  try {
    const response = await fetch(trimmed, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; NewsChecker/1.0)",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      },
      cache: "no-store",
    });

    if (!response.ok) {
      return {
        extractedText: "",
        extractionUsed: false,
        extractionWarning:
          "링크 본문 추출에 실패했습니다. 기사 본문을 직접 붙여넣어 주세요.",
        extractionConfidence: "낮음",
        extractionReliable: false,
        sourceType: "url",
        sourceDomain,
        extractedTitle: "",
        extractor: "fetch_failed",
      };
    }

    const html = await response.text();

    const { JSDOM } = await import("jsdom");
    const { Readability } = await import("@mozilla/readability");

    const dom = new JSDOM(html, { url: trimmed });
    const doc = dom.window.document;

    const titleCandidates = [
      doc.querySelector('meta[property="og:title"]')?.getAttribute("content"),
      doc.querySelector('meta[name="twitter:title"]')?.getAttribute("content"),
      doc.querySelector("title")?.textContent,
      doc.querySelector("h1")?.textContent,
    ];
    const title = normalizeWhitespace(titleCandidates.find(Boolean) || "");

    const metaCandidates = [
      doc.querySelector('meta[property="og:description"]')?.getAttribute("content"),
      doc.querySelector('meta[name="description"]')?.getAttribute("content"),
      doc.querySelector('meta[name="twitter:description"]')?.getAttribute("content"),
    ];
    const metaDescription = normalizeWhitespace(metaCandidates.find(Boolean) || "");

    const selectorCandidates = [
      "article",
      "main",
      '[role="main"]',
      ".article",
      ".article-body",
      ".article__body",
      ".story-body",
      ".news-body",
      ".content",
      "#content",
      ".news_end",
      ".article_txt",
    ];

    const chunks: string[] = [];

    for (const selector of selectorCandidates) {
      const el = doc.querySelector(selector);
      if (!el) continue;
      const text = normalizeWhitespace(el.textContent || "");
      if (text.length >= 300) chunks.push(text);
    }

    const selectorText = cleanLines(chunks.sort((a, b) => b.length - a.length)[0] || "");

    const reader = new Readability(doc);
    const article = reader.parse();
    const readabilityText = cleanLines(article?.textContent || "");

    const candidates = [
      { kind: "readability", text: normalizeWhitespace(readabilityText) },
      { kind: "selector", text: normalizeWhitespace(selectorText) },
      { kind: "meta", text: normalizeWhitespace(metaDescription) },
    ].filter((c) => c.text);

    if (candidates.length === 0) {
      return {
        extractedText: "",
        extractionUsed: false,
        extractionWarning:
          "링크 본문 추출 신뢰도가 낮습니다. 기사 본문을 직접 붙여넣어 주세요.",
        extractionConfidence: "낮음",
        extractionReliable: false,
        sourceType: "url",
        sourceDomain,
        extractedTitle: title,
        extractor: "none",
      };
    }

    const scored = candidates.map((candidate) => {
      const qualityScore = scoreExtractedTextQuality(candidate.text);
      const titleOverlap = titleBodyOverlapScore(title, candidate.text);

      const total =
        qualityScore * 0.72 +
        titleOverlap * 0.28 +
        (candidate.kind === "readability" ? 6 : 0);

      return {
        ...candidate,
        qualityScore,
        titleOverlap,
        total,
      };
    });

    scored.sort((a, b) => b.total - a.total);
    const best = scored[0];
    const wrapper = isWrapperDomain(sourceDomain);

    if (!best.text || best.qualityScore < 35) {
      return {
        extractedText: "",
        extractionUsed: false,
        extractionWarning:
          "링크 본문 추출 신뢰도가 낮습니다. 기사 본문을 직접 붙여넣어 주세요.",
        extractionConfidence: "낮음",
        extractionReliable: false,
        sourceType: "url",
        sourceDomain,
        extractedTitle: title,
        extractor: best.kind,
      };
    }

    if (wrapper && best.titleOverlap < 20) {
      return {
        extractedText: "",
        extractionUsed: false,
        extractionWarning:
          "포털 링크에서 본문 추출 신뢰도가 낮습니다. 원문 기사 링크나 기사 본문을 직접 붙여넣어 주세요.",
        extractionConfidence: "낮음",
        extractionReliable: false,
        sourceType: "url",
        sourceDomain,
        extractedTitle: title,
        extractor: best.kind,
      };
    }

    let extractionConfidence: ExtractionConfidence = "높음";
    let extractionWarning = "";

    if (wrapper) {
      extractionConfidence = "중간";
      extractionWarning =
        "포털 링크는 원문과 일부 차이가 있을 수 있습니다. 가장 정확한 분석을 위해 기사 본문도 함께 붙여넣는 것을 권장합니다.";
    }

    if (best.qualityScore < 55 || best.titleOverlap < 30) {
      extractionConfidence = "중간";
      if (!extractionWarning) {
        extractionWarning =
          "본문 추출 품질이 아주 높지는 않습니다. 분석 결과를 참고용으로 봐 주세요.";
      }
    }

    return {
      extractedText: best.text,
      extractionUsed: true,
      extractionWarning,
      extractionConfidence,
      extractionReliable: true,
      sourceType: "url",
      sourceDomain,
      extractedTitle: title,
      extractor: best.kind,
    };
  } catch (error) {
    console.error("extractArticleText error:", error);

    return {
      extractedText: "",
      extractionUsed: false,
      extractionWarning:
        "링크 본문 추출 중 오류가 발생했습니다. 기사 본문을 직접 붙여넣어 주세요.",
      extractionConfidence: "낮음",
      extractionReliable: false,
      sourceType: "url",
      sourceDomain,
      extractedTitle: "",
      extractor: "exception",
    };
  }
}

function buildPrompt(text: string) {
  return `
너는 뉴스 공유 전 판단을 돕는 고급 분석기다.
입력된 기사 제목 또는 기사 본문을 바탕으로 신뢰도 보조 판단을 수행하라.

중요 규칙:
- 정치적 편향 없이 중립적으로 작성
- 절대 "가짜뉴스"라고 단정하지 말 것
- 불충분한 정보는 보수적으로 평가
- 추측을 사실처럼 쓰지 말 것
- 출력은 반드시 JSON만
- 코드블록 금지
- 짧고 명확한 한국어 사용
- confirmedFacts는 입력에서 비교적 명확한 내용만
- uncertainFacts는 추가 확인이 필요한 내용만
- issues는 짧은 체크 포인트
- crossChecks는 실제 웹 검색이 아니라 "다른 보도에서 달라질 수 있는 지점" 기준의 비교 관점 요약

반드시 아래 형식으로만 출력:
{
  "summary": "한줄 판단",
  "verdict": "종합 판단 한 문장",
  "confirmedFacts": ["..."],
  "uncertainFacts": ["..."],
  "issues": ["..."],
  "crossChecks": [
    {
      "source": "다른 보도 관점 1",
      "status": "일치",
      "note": "핵심 사실은 대체로 맞아 보임"
    }
  ],
  "scoreBreakdown": {
    "sourceReliability": 0,
    "primarySource": 0,
    "crossVerification": 0,
    "sensationalism": 0,
    "evidenceQuality": 0
  }
}

점수 기준:
- sourceReliability: -20 ~ 20
- primarySource: -20 ~ 20
- crossVerification: -15 ~ 15
- sensationalism: -20 ~ 0
- evidenceQuality: -25 ~ 15

분석 대상:
${text}
`;
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const input = String(body?.input ?? "").trim();

    if (!input) {
      return NextResponse.json(
        { error: "링크나 텍스트를 입력해 주세요." },
        { status: 400 }
      );
    }

    const extracted = await extractArticleText(input);

    if (!extracted.extractionReliable) {
      return NextResponse.json(
        {
          error: extracted.extractionWarning || "본문 추출 신뢰도가 낮습니다.",
          needFullText: true,
          meta: {
            sourceType: extracted.sourceType,
            sourceDomain: extracted.sourceDomain,
            extractionConfidence: extracted.extractionConfidence,
            extractedTitle: extracted.extractedTitle,
            extractor: extracted.extractor,
          },
        },
        { status: 400 }
      );
    }

    const ai = await client.responses.create({
      model: "gpt-4.1-mini",
      input: buildPrompt(extracted.extractedText),
    });

    const raw = sanitizeModelJson(ai.output_text || "{}");
    const parsed = safeJsonParse<Partial<AnalysisPayload>>(raw, {});

    const scoreBreakdown = normalizeScoreBreakdown(parsed.scoreBreakdown);
    const issues = normalizeStringArray(parsed.issues, 5);
    const exaggeration = detectExaggeration(extracted.extractedText);

    const trustScore = clamp(
      50 +
        scoreBreakdown.sourceReliability +
        scoreBreakdown.primarySource +
        scoreBreakdown.crossVerification +
        scoreBreakdown.sensationalism +
        scoreBreakdown.evidenceQuality
    );

    const clickbaitScore = calculateClickbaitScore({
      exaggerationCount: exaggeration.count,
      sensationalism: scoreBreakdown.sensationalism,
      evidenceQuality: scoreBreakdown.evidenceQuality,
      primarySource: scoreBreakdown.primarySource,
      sourceReliability: scoreBreakdown.sourceReliability,
      issues,
    });

    return NextResponse.json({
      trustScore,
      riskLevel: getRiskLevel(trustScore),
      clickbaitScore,
      clickbaitLevel: getClickbaitLevel(clickbaitScore),
      clickbaitReasons: buildClickbaitReasons({
        exaggerationCount: exaggeration.count,
        sensationalism: scoreBreakdown.sensationalism,
        evidenceQuality: scoreBreakdown.evidenceQuality,
        primarySource: scoreBreakdown.primarySource,
        sourceReliability: scoreBreakdown.sourceReliability,
      }),
      summary:
        typeof parsed.summary === "string" && parsed.summary.trim()
          ? parsed.summary.trim()
          : "추가 확인이 필요합니다.",
      verdict:
        typeof parsed.verdict === "string" && parsed.verdict.trim()
          ? parsed.verdict.trim()
          : "현재 정보 기준 일부 사실과 불확실성이 함께 존재합니다.",
      confirmedFacts: normalizeStringArray(parsed.confirmedFacts, 5),
      uncertainFacts: normalizeStringArray(parsed.uncertainFacts, 5),
      issues,
      crossChecks: normalizeCrossChecks(parsed.crossChecks, 5),
      scoreBreakdown,
      exaggeration,
      meta: {
        extractionUsed: extracted.extractionUsed,
        extractionWarning: extracted.extractionWarning,
        extractionConfidence: extracted.extractionConfidence,
        sourceType: extracted.sourceType,
        sourceDomain: extracted.sourceDomain,
        extractedTitle: extracted.extractedTitle,
        extractor: extracted.extractor,
        analyzedTextLength: extracted.extractedText.length,
      },
    });
  } catch (error) {
    console.error("analyze route error:", error);

    return NextResponse.json(
      {
        error: "분석 처리 중 오류가 발생했습니다.",
        detail: error instanceof Error ? error.message : "unknown error",
      },
      { status: 500 }
    );
  }
}