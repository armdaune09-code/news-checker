import { NextResponse } from "next/server";
import OpenAI from "openai";
import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

type SourceType = "url" | "text";
type ExtractionConfidence = "높음" | "중간" | "낮음";

function isValidUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function sanitize(raw: string) {
  return raw
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
}

function clamp(n: number) {
  return Math.max(0, Math.min(100, Math.round(n)));
}

function getRiskLevel(score: number): "낮음" | "중간" | "높음" {
  if (score >= 70) return "낮음";
  if (score >= 40) return "중간";
  return "높음";
}

function getClickbaitLevel(score: number): "낮음" | "주의" | "높음" {
  if (score >= 70) return "높음";
  if (score >= 40) return "주의";
  return "낮음";
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

function normalizeStringArray(value: unknown, max = 5): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, max);
}

function normalizeCrossChecks(value: unknown, max = 5) {
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;

      const source =
        typeof (item as any).source === "string" ? (item as any).source.trim() : "";
      const status =
        (item as any).status === "일치" ||
        (item as any).status === "일부 일치" ||
        (item as any).status === "불일치"
          ? (item as any).status
          : "일부 일치";
      const note =
        typeof (item as any).note === "string" ? (item as any).note.trim() : "";

      if (!source || !note) return null;
      return { source, status, note };
    })
    .filter(Boolean)
    .slice(0, max);
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
    "경악스러운",
    "충격 고백",
    "아수라장",
    "대혼란",
    "믿을 수 없는",
    "소름 돋는",
  ];

  const found = keywords.filter((keyword) => text.includes(keyword));

  return {
    count: found.length,
    words: found.slice(0, 6),
  };
}

function buildClickbaitReason(params: {
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

  if (reasons.length === 0) {
    reasons.push("낚시성 징후가 두드러지지 않음");
  }

  return reasons.slice(0, 4);
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

  score += Math.min(params.exaggerationCount * 18, 36);
  score += Math.max(-params.sensationalism * 2, 0);
  score += Math.max(-params.evidenceQuality * 1.5, 0);
  score += Math.max(-params.primarySource * 1.2, 0);
  score += Math.max(-params.sourceReliability, 0);

  const suspiciousIssueHits = params.issues.filter((issue) =>
    ["과장", "출처", "검증", "근거", "불명확", "자극"].some((keyword) =>
      issue.includes(keyword)
    )
  ).length;

  score += suspiciousIssueHits * 6;

  return clamp(score);
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
  ];

  return badWords.filter((word) => text.includes(word)).length;
}

function scoreExtractedTextQuality(text: string) {
  const normalized = normalizeWhitespace(text);
  const len = normalized.length;
  const badSignalCount = countBadSignals(normalized);

  let score = 0;

  if (len >= 400) score += 25;
  if (len >= 800) score += 20;
  if (len >= 1400) score += 15;

  if (badSignalCount === 0) score += 20;
  if (badSignalCount === 1) score += 10;
  if (badSignalCount >= 3) score -= 20;

  const sentenceCount = normalized
    .split(/[.!?。！？]\s|다\.\s|요\.\s/)
    .filter(Boolean).length;

  if (sentenceCount >= 5) score += 15;
  if (sentenceCount >= 10) score += 10;

  return clamp(score);
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

function extractMetaTitle(doc: Document) {
  const candidates = [
    doc.querySelector('meta[property="og:title"]')?.getAttribute("content"),
    doc.querySelector('meta[name="twitter:title"]')?.getAttribute("content"),
    doc.querySelector("title")?.textContent,
    doc.querySelector("h1")?.textContent,
  ];

  return normalizeWhitespace(candidates.find(Boolean) || "");
}

function extractMetaDescription(doc: Document) {
  const candidates = [
    doc.querySelector('meta[property="og:description"]')?.getAttribute("content"),
    doc.querySelector('meta[name="description"]')?.getAttribute("content"),
    doc.querySelector('meta[name="twitter:description"]')?.getAttribute("content"),
  ];

  return normalizeWhitespace(candidates.find(Boolean) || "");
}

function extractBySelectors(doc: Document) {
  const selectors = [
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
  ];

  const chunks: string[] = [];

  for (const selector of selectors) {
    const el = doc.querySelector(selector);
    if (!el) continue;

    const text = normalizeWhitespace(el.textContent || "");
    if (text.length >= 300) {
      chunks.push(text);
    }
  }

  return chunks.sort((a, b) => b.length - a.length)[0] || "";
}

function chooseBestExtractedText(params: {
  readabilityText: string;
  selectorText: string;
  metaDescription: string;
  title: string;
}) {
  const candidates = [
    { kind: "readability", text: normalizeWhitespace(params.readabilityText) },
    { kind: "selector", text: normalizeWhitespace(params.selectorText) },
    { kind: "meta", text: normalizeWhitespace(params.metaDescription) },
  ].filter((c) => c.text);

  if (candidates.length === 0) {
    return {
      text: "",
      extractor: "none",
      qualityScore: 0,
      titleOverlap: 0,
    };
  }

  const scored = candidates.map((candidate) => {
    const qualityScore = scoreExtractedTextQuality(candidate.text);
    const titleOverlap = titleBodyOverlapScore(params.title, candidate.text);

    const total =
      qualityScore * 0.7 +
      titleOverlap * 0.3 +
      (candidate.kind === "readability" ? 8 : 0);

    return {
      ...candidate,
      qualityScore,
      titleOverlap,
      total,
    };
  });

  scored.sort((a, b) => b.total - a.total);

  return {
    text: scored[0].text,
    extractor: scored[0].kind,
    qualityScore: scored[0].qualityScore,
    titleOverlap: scored[0].titleOverlap,
  };
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
    const dom = new JSDOM(html, { url: trimmed });
    const doc = dom.window.document;

    const title = extractMetaTitle(doc);
    const metaDescription = extractMetaDescription(doc);

    const reader = new Readability(doc);
    const article = reader.parse();
    const readabilityText = cleanLines(article?.textContent || "");
    const selectorText = cleanLines(extractBySelectors(doc));

    const best = chooseBestExtractedText({
      readabilityText,
      selectorText,
      metaDescription,
      title,
    });

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
        extractor: best.extractor,
      };
    }

    if (wrapper && best.titleOverlap < 20) {
      return {
        extractedText: "",
        extractionUsed: false,
        extractionWarning:
          "포털/래퍼 링크에서 본문 추출 신뢰도가 낮습니다. 원문 기사 링크나 기사 본문을 직접 붙여넣어 주세요.",
        extractionConfidence: "낮음",
        extractionReliable: false,
        sourceType: "url",
        sourceDomain,
        extractedTitle: title,
        extractor: best.extractor,
      };
    }

    let extractionConfidence: ExtractionConfidence = "높음";
    let extractionWarning = "";

    if (wrapper) {
      extractionConfidence = "중간";
      extractionWarning =
        "포털/래퍼 링크는 원문과 일부 차이가 있을 수 있습니다. 가장 정확한 분석을 위해 기사 본문을 함께 붙여넣는 것을 권장합니다.";
    }

    if (best.qualityScore < 55 || best.titleOverlap < 30) {
      extractionConfidence = "중간";
      if (!extractionWarning) {
        extractionWarning =
          "본문 추출 품질이 아주 높지는 않습니다. 분석 결과를 참고용으로만 봐 주세요.";
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
      extractor: best.extractor,
    };
  } catch {
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

    const prompt = `
너는 뉴스 공유 전 판단을 돕는 보조 분석기다.
입력된 기사나 뉴스성 텍스트를 바탕으로 신뢰도 보조 판단을 수행하라.

중요 규칙:
- 정치적 편향 없이 중립적으로 작성
- 절대 "가짜뉴스"라고 단정하지 말 것
- 불충분한 정보는 보수적으로 평가
- 출력은 반드시 JSON만
- 코드블록 금지
- 짧고 명확한 한국어 사용
- confirmedFacts는 입력에서 비교적 명확한 내용만
- uncertainFacts는 근거가 약하거나 추가 확인이 필요한 내용만
- issues는 짧은 체크 포인트
- crossChecks는 실제 웹 검색 결과가 아니라, 입력 기준에서 가능한 비교 관점 요약
- crossChecks가 어렵다면 빈 배열 허용

반드시 아래 형식만 출력:
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
${extracted.extractedText}
`;

    const ai = await client.responses.create({
      model: "gpt-4.1-mini",
      input: prompt,
    });

    const text = sanitize(ai.output_text || "{}");
    const data = JSON.parse(text);

    const b = data?.scoreBreakdown ?? {};
    const issues = normalizeStringArray(data?.issues, 5);
    const exaggeration = detectExaggeration(extracted.extractedText);

    const trustScore = clamp(
      50 +
        Number(b.sourceReliability ?? 0) +
        Number(b.primarySource ?? 0) +
        Number(b.crossVerification ?? 0) +
        Number(b.sensationalism ?? 0) +
        Number(b.evidenceQuality ?? 0)
    );

    const clickbaitScore = calculateClickbaitScore({
      exaggerationCount: exaggeration.count,
      sensationalism: Number(b.sensationalism ?? 0),
      evidenceQuality: Number(b.evidenceQuality ?? 0),
      primarySource: Number(b.primarySource ?? 0),
      sourceReliability: Number(b.sourceReliability ?? 0),
      issues,
    });

    return NextResponse.json({
      trustScore,
      riskLevel: getRiskLevel(trustScore),
      clickbaitScore,
      clickbaitLevel: getClickbaitLevel(clickbaitScore),
      clickbaitReasons: buildClickbaitReason({
        exaggerationCount: exaggeration.count,
        sensationalism: Number(b.sensationalism ?? 0),
        evidenceQuality: Number(b.evidenceQuality ?? 0),
        primarySource: Number(b.primarySource ?? 0),
        sourceReliability: Number(b.sourceReliability ?? 0),
      }),
      summary:
        typeof data?.summary === "string" && data.summary.trim()
          ? data.summary.trim()
          : "추가 확인이 필요합니다.",
      verdict:
        typeof data?.verdict === "string" && data.verdict.trim()
          ? data.verdict.trim()
          : "현재 정보 기준 일부 사실과 불확실성이 함께 존재합니다.",
      confirmedFacts: normalizeStringArray(data?.confirmedFacts, 5),
      uncertainFacts: normalizeStringArray(data?.uncertainFacts, 5),
      issues,
      crossChecks: normalizeCrossChecks(data?.crossChecks, 5),
      scoreBreakdown: {
        sourceReliability: Number(b.sourceReliability ?? 0),
        primarySource: Number(b.primarySource ?? 0),
        crossVerification: Number(b.crossVerification ?? 0),
        sensationalism: Number(b.sensationalism ?? 0),
        evidenceQuality: Number(b.evidenceQuality ?? 0),
      },
      exaggeration,
      meta: {
        extractionUsed: extracted.extractionUsed,
        extractionWarning: extracted.extractionWarning,
        extractionConfidence: extracted.extractionConfidence,
        sourceType: extracted.sourceType,
        sourceDomain: extracted.sourceDomain,
        extractedTitle: extracted.extractedTitle,
        extractor: extracted.extractor,
      },
    });
  } catch (error) {
    console.error("analyze route error:", error);

    return NextResponse.json(
      { error: "분석 처리 중 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}