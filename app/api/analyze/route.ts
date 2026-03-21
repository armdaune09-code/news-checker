import { NextResponse } from "next/server";
import OpenAI from "openai";

export const dynamic = "force-dynamic";

type ExtractionMethod =
  | "naver-selector"
  | "body-fallback"
  | "meta-fallback"
  | "raw"
  | "failed";

type Verdict = "사실 가능성 높음" | "불확실" | "허위 가능성 높음";
type Decision = "공유 추천" | "주의" | "비추천";

type EvidenceSource = {
  title: string;
  description: string;
  articleUrl: string;
  sourceName: string;
  sourceUrl: string;
  publishedAt: string;
};

type AnalyzeResponse = {
  trustScore: number;
  riskLevel: string;
  clickbaitScore: number;
  verdict: Verdict;
  decision: Decision;
  summary: string;
  facts: string[];
  cautions: string[];
  coreSummary: string;
  shareSummary: string;
  evidenceSources: EvidenceSource[];
  meta: {
    sourceDomain?: string;
    extractionMethod: ExtractionMethod;
    length: number;
    searchQuery?: string;
    webEvidenceCount: number;
    webVerificationEnabled: boolean;
    aiEnabled: boolean;
    extractedTitle?: string;
  };
  error?: string;
  detail?: string;
};

const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

function clamp(n: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Math.round(n)));
}

function getRiskLevel(score: number) {
  if (score >= 80) return "낮음";
  if (score >= 60) return "중간";
  return "높음";
}

function isUrl(text: string) {
  return /^https?:\/\//i.test(text);
}

function isKorean(text: string) {
  return /[가-힣]/.test(text);
}

function cleanText(text: string) {
  return text
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function safeJsonParse<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(
      raw.replace(/```json/gi, "").replace(/```/g, "").trim()
    ) as T;
  } catch {
    return fallback;
  }
}

function extractMetaContent(html: string, key: string) {
  const patterns = [
    new RegExp(
      `<meta[^>]*property=["']${key}["'][^>]*content=["']([^"']+)["'][^>]*>`,
      "i"
    ),
    new RegExp(
      `<meta[^>]*content=["']([^"']+)["'][^>]*property=["']${key}["'][^>]*>`,
      "i"
    ),
    new RegExp(
      `<meta[^>]*name=["']${key}["'][^>]*content=["']([^"']+)["'][^>]*>`,
      "i"
    ),
    new RegExp(
      `<meta[^>]*content=["']([^"']+)["'][^>]*name=["']${key}["'][^>]*>`,
      "i"
    ),
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return cleanText(match[1]);
  }

  return "";
}

function extractTitle(html: string) {
  const og = extractMetaContent(html, "og:title");
  if (og) return og;

  const twitter = extractMetaContent(html, "twitter:title");
  if (twitter) return twitter;

  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (titleMatch?.[1]) return cleanText(titleMatch[1]);

  return "";
}

function extractDescription(html: string) {
  return (
    extractMetaContent(html, "og:description") ||
    extractMetaContent(html, "description") ||
    extractMetaContent(html, "twitter:description") ||
    ""
  );
}

function extractBodyText(html: string) {
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  const source = bodyMatch ? bodyMatch[1] : html;
  return cleanText(source);
}

function extractNaverText(html: string) {
  const patterns = [
    /<div[^>]*id=["']dic_area["'][^>]*>([\s\S]*?)<\/div>/i,
    /<article[^>]*id=["']dic_area["'][^>]*>([\s\S]*?)<\/article>/i,
    /<div[^>]*class=["'][^"']*newsct_article[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
    /<div[^>]*id=["']articleBodyContents["'][^>]*>([\s\S]*?)<\/div>/i,
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) {
      const text = cleanText(match[1]);
      if (text.length > 100) return text;
    }
  }

  return "";
}

async function fetchWithTimeout(url: string, timeoutMs = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
        "Cache-Control": "no-cache",
      },
      redirect: "follow",
      cache: "no-store",
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function extractFromUrl(url: string): Promise<{
  text: string;
  extractionMethod: ExtractionMethod;
  sourceDomain: string;
  extractedTitle: string;
}> {
  let sourceDomain = "";
  try {
    sourceDomain = new URL(url).hostname.replace(/^www\./, "");
  } catch {
    sourceDomain = "";
  }

  try {
    const res = await fetchWithTimeout(url);
    if (!res.ok) {
      return {
        text: "",
        extractionMethod: "failed",
        sourceDomain,
        extractedTitle: "",
      };
    }

    const html = await res.text();
    const extractedTitle = extractTitle(html);
    const description = extractDescription(html);

    if (sourceDomain.includes("naver.com")) {
      const naverText = extractNaverText(html);
      if (naverText.length > 100) {
        return {
          text: naverText,
          extractionMethod: "naver-selector",
          sourceDomain,
          extractedTitle,
        };
      }
    }

    const bodyText = extractBodyText(html);
    if (bodyText.length > 300) {
      return {
        text: bodyText,
        extractionMethod: "body-fallback",
        sourceDomain,
        extractedTitle,
      };
    }

    const metaFallback = cleanText(
      [extractedTitle, description, url].filter(Boolean).join(" ")
    );

    if (metaFallback.length > 20) {
      return {
        text: metaFallback,
        extractionMethod: "meta-fallback",
        sourceDomain,
        extractedTitle,
      };
    }

    return {
      text: "",
      extractionMethod: "failed",
      sourceDomain,
      extractedTitle,
    };
  } catch {
    return {
      text: "",
      extractionMethod: "failed",
      sourceDomain,
      extractedTitle: "",
    };
  }
}

function calcClickbaitScore(text: string) {
  const keywords = [
    "충격",
    "단독",
    "경악",
    "난리",
    "대박",
    "실화",
    "전액 현금",
    "100억",
    "역대급",
    "결국",
    "반전",
    "폭로",
    "발칵",
    "초비상",
  ];

  let score = 0;
  for (const word of keywords) {
    if (text.includes(word)) score += 10;
  }

  if (text.length < 80) score += 10;

  return clamp(score);
}

function fallbackCoreSummary(text: string) {
  const cleaned = cleanText(text);
  if (cleaned.length <= 180) return cleaned;
  return `${cleaned.slice(0, 177)}...`;
}

function fallbackShareSummary(text: string, title = "") {
  const source = cleanText([title, text].filter(Boolean).join(" "));
  if (source.length <= 180) return source;
  return `${source.slice(0, 177)}...`;
}

function buildFallbackResult(args: {
  text: string;
  sourceDomain: string;
  extractionMethod: ExtractionMethod;
  evidenceSources: EvidenceSource[];
  searchQuery: string;
  extractedTitle: string;
  clickbaitScore: number;
}): AnalyzeResponse {
  const facts: string[] = [];
  const cautions: string[] = [];

  let trustScore = 55;

  if (args.extractionMethod === "naver-selector") {
    trustScore += 10;
    facts.push("네이버 기사 본문 추출 성공");
  } else if (args.extractionMethod === "body-fallback") {
    facts.push("본문 텍스트 기반 분석");
  } else if (args.extractionMethod === "meta-fallback") {
    cautions.push("제목/설명 기반으로 분석됨");
    trustScore -= 8;
  } else if (args.extractionMethod === "failed") {
    cautions.push("링크 본문 추출 실패");
    trustScore -= 12;
  }

  if (args.sourceDomain) {
    facts.push(`출처 도메인 확인: ${args.sourceDomain}`);
  }

  if (args.text.length > 500) {
    facts.push("분석 가능한 텍스트 길이 확보");
    trustScore += 8;
  } else if (args.text.length < 100) {
    cautions.push("텍스트 길이가 짧아 판단 근거가 약함");
    trustScore -= 15;
  }

  if (args.evidenceSources.length > 0) {
    facts.push(`관련 웹 기사 ${args.evidenceSources.length}건 확인`);
    trustScore += 15;
  } else {
    cautions.push("관련 웹 기사 근거를 충분히 찾지 못함");
  }

  if (args.clickbaitScore >= 40) {
    cautions.push("자극적 표현 가능성이 높음");
    trustScore -= 15;
  }

  trustScore = clamp(trustScore);

  let verdict: Verdict = "불확실";
  if (trustScore >= 75) verdict = "사실 가능성 높음";
  else if (trustScore < 40) verdict = "허위 가능성 높음";

  let decision: Decision = "주의";
  if (trustScore >= 80 && args.clickbaitScore < 35) decision = "공유 추천";
  else if (trustScore < 50) decision = "비추천";

  return {
    trustScore,
    riskLevel: getRiskLevel(trustScore),
    clickbaitScore: args.clickbaitScore,
    verdict,
    decision,
    summary:
      verdict === "사실 가능성 높음"
        ? "현재 기준 관련 근거가 일부 확인됩니다."
        : verdict === "허위 가능성 높음"
        ? "현재 기준 그대로 믿기엔 위험한 정보입니다."
        : "추가 확인이 필요한 정보입니다.",
    facts: facts.slice(0, 4),
    cautions: cautions.slice(0, 4),
    coreSummary: fallbackCoreSummary(args.text),
    shareSummary:
      args.evidenceSources[0]?.title ||
      args.extractedTitle ||
      fallbackShareSummary(args.text, args.extractedTitle),
    evidenceSources: args.evidenceSources.slice(0, 5),
    meta: {
      sourceDomain: args.sourceDomain,
      extractionMethod: args.extractionMethod,
      length: args.text.length,
      searchQuery: args.searchQuery,
      webEvidenceCount: args.evidenceSources.length,
      webVerificationEnabled: Boolean(process.env.GNEWS_API_KEY),
      aiEnabled: Boolean(process.env.OPENAI_API_KEY),
      extractedTitle: args.extractedTitle,
    },
  };
}

async function buildSearchSeed(text: string, extractedTitle = "") {
  const seedText = [extractedTitle, text].filter(Boolean).join(" ");

  if (!openai) {
    return {
      claim: fallbackCoreSummary(seedText),
      searchQuery: fallbackCoreSummary(seedText).slice(0, 60),
      coreSummary: fallbackCoreSummary(seedText),
      clickbaitScore: calcClickbaitScore(seedText),
    };
  }

  try {
    const prompt = `
너는 뉴스 검증용 검색어 생성기다.
입력 글에서 핵심 주장만 뽑아 검색용 키워드를 만든다.
반드시 JSON만 출력해라.

형식:
{
  "claim": "핵심 주장 한 줄",
  "searchQuery": "웹 검색용 키워드",
  "coreSummary": "이 글의 핵심 내용 요약",
  "clickbaitScore": 0
}

규칙:
- claim은 검증 가능한 주장만
- searchQuery는 인물/기관/장소/금액/사건명을 최대한 살린다
- coreSummary는 자연스러운 한국어 1~2문장
- clickbaitScore는 0~100

분석 대상:
${seedText.slice(0, 3500)}
`;

    const resp = await openai.responses.create({
      model: "gpt-4.1-mini",
      input: prompt,
    });

    return safeJsonParse(resp.output_text || "{}", {
      claim: fallbackCoreSummary(seedText),
      searchQuery: fallbackCoreSummary(seedText).slice(0, 60),
      coreSummary: fallbackCoreSummary(seedText),
      clickbaitScore: calcClickbaitScore(seedText),
    });
  } catch {
    return {
      claim: fallbackCoreSummary(seedText),
      searchQuery: fallbackCoreSummary(seedText).slice(0, 60),
      coreSummary: fallbackCoreSummary(seedText),
      clickbaitScore: calcClickbaitScore(seedText),
    };
  }
}

async function searchGNews(query: string, lang: "ko" | "en") {
  const apiKey = process.env.GNEWS_API_KEY;
  if (!apiKey) return [] as EvidenceSource[];

  const params = new URLSearchParams({
    q: query,
    lang,
    max: "5",
    sortby: "relevance",
    in: "title,description",
  });

  const url = `https://gnews.io/api/v4/search?${params.toString()}`;

  try {
    const res = await fetch(url, {
      headers: {
        "X-Api-Key": apiKey,
      },
      cache: "no-store",
    });

    if (!res.ok) return [] as EvidenceSource[];

    const data = (await res.json()) as {
      articles?: Array<{
        title?: string;
        description?: string;
        url?: string;
        publishedAt?: string;
        source?: {
          name?: string;
          url?: string;
        };
      }>;
    };

    return (data.articles || [])
      .map((a) => ({
        title: a.title || "",
        description: a.description || "",
        articleUrl: a.url || "",
        sourceName: a.source?.name || "",
        sourceUrl: a.source?.url || "",
        publishedAt: a.publishedAt || "",
      }))
      .filter((a) => a.title && a.articleUrl);
  } catch {
    return [] as EvidenceSource[];
  }
}

async function analyzeWithEvidence(args: {
  inputText: string;
  claim: string;
  coreSummary: string;
  evidence: EvidenceSource[];
  extractionMethod: ExtractionMethod;
  sourceDomain: string;
  searchQuery: string;
  clickbaitScore: number;
  extractedTitle: string;
}): Promise<AnalyzeResponse> {
  if (!openai) {
    return buildFallbackResult({
      text: args.inputText,
      sourceDomain: args.sourceDomain,
      extractionMethod: args.extractionMethod,
      evidenceSources: args.evidence,
      searchQuery: args.searchQuery,
      extractedTitle: args.extractedTitle,
      clickbaitScore: args.clickbaitScore,
    });
  }

  const evidenceText =
    args.evidence.length > 0
      ? args.evidence
          .map(
            (e, i) =>
              `${i + 1}. [${e.sourceName}] ${e.title} | ${e.description} | ${e.publishedAt} | ${e.articleUrl}`
          )
          .join("\n")
      : "검색된 관련 기사 없음";

  try {
    const prompt = `
너는 "웹 근거 기반 뉴스 검증기"다.
입력 글과 웹 기사들을 비교해서 JSON만 출력해라.

형식:
{
  "trustScore": 0,
  "verdict": "사실 가능성 높음 | 불확실 | 허위 가능성 높음",
  "decision": "공유 추천 | 주의 | 비추천",
  "summary": "공유 전 판단용 한줄 결론",
  "facts": ["확인된 내용 1", "확인된 내용 2"],
  "cautions": ["주의 포인트 1", "주의 포인트 2"],
  "coreSummary": "이 글 핵심 내용 요약",
  "shareSummary": "사람이 그대로 복사해 공유할 수 있는 자연스러운 뉴스형 1~2문장 요약"
}

규칙:
- summary는 판정 한줄
- coreSummary는 글 핵심 내용 요약
- shareSummary는 사건 내용 요약이어야 하고 분석 설명처럼 쓰지 말 것
- facts는 웹 기사로 확인되는 내용 중심
- cautions는 추정/불일치/출처 부족 중심
- 본문 추출 실패 시 그 사실을 caution으로 반영할 수는 있지만 앱이 죽으면 안 됨
- 최대한 자연스러운 한국어

입력 주장:
${args.claim}

입력 글 핵심:
${args.coreSummary}

입력 글 원문:
${args.inputText.slice(0, 3000)}

본문 추출 방식:
${args.extractionMethod}
출처 도메인:
${args.sourceDomain || "-"}

웹 기사 목록:
${evidenceText}
`;

    const resp = await openai.responses.create({
      model: "gpt-4.1-mini",
      input: prompt,
    });

    const parsed = safeJsonParse<{
      trustScore: number;
      verdict: Verdict;
      decision: Decision;
      summary: string;
      facts: string[];
      cautions: string[];
      coreSummary: string;
      shareSummary: string;
    }>(resp.output_text || "{}", {
      trustScore: 50,
      verdict: "불확실",
      decision: "주의",
      summary: "추가 확인이 필요한 정보입니다.",
      facts: [],
      cautions: [],
      coreSummary: args.coreSummary || fallbackCoreSummary(args.inputText),
      shareSummary: fallbackShareSummary(args.inputText, args.extractedTitle),
    });

    const trustScore = clamp(parsed.trustScore ?? 50);

    return {
      trustScore,
      riskLevel: getRiskLevel(trustScore),
      clickbaitScore: args.clickbaitScore,
      verdict: parsed.verdict || "불확실",
      decision: parsed.decision || "주의",
      summary: parsed.summary || "추가 확인이 필요한 정보입니다.",
      facts: Array.isArray(parsed.facts) ? parsed.facts.slice(0, 4) : [],
      cautions: Array.isArray(parsed.cautions) ? parsed.cautions.slice(0, 4) : [],
      coreSummary:
        parsed.coreSummary || args.coreSummary || fallbackCoreSummary(args.inputText),
      shareSummary:
        parsed.shareSummary ||
        args.extractedTitle ||
        args.coreSummary ||
        fallbackShareSummary(args.inputText, args.extractedTitle),
      evidenceSources: args.evidence.slice(0, 5),
      meta: {
        sourceDomain: args.sourceDomain,
        extractionMethod: args.extractionMethod,
        length: args.inputText.length,
        searchQuery: args.searchQuery,
        webEvidenceCount: args.evidence.length,
        webVerificationEnabled: Boolean(process.env.GNEWS_API_KEY),
        aiEnabled: true,
        extractedTitle: args.extractedTitle,
      },
    };
  } catch {
    return buildFallbackResult({
      text: args.inputText,
      sourceDomain: args.sourceDomain,
      extractionMethod: args.extractionMethod,
      evidenceSources: args.evidence,
      searchQuery: args.searchQuery,
      extractedTitle: args.extractedTitle,
      clickbaitScore: args.clickbaitScore,
    });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const input = typeof body?.input === "string" ? body.input.trim() : "";

    if (!input) {
      return NextResponse.json(
        {
          error: "입력값 없음",
          trustScore: 0,
          riskLevel: "높음",
          clickbaitScore: 0,
          verdict: "불확실",
          decision: "비추천",
          summary: "입력값이 없습니다.",
          facts: [],
          cautions: [],
          coreSummary: "",
          shareSummary: "",
          evidenceSources: [],
          meta: {
            extractionMethod: "failed" as ExtractionMethod,
            length: 0,
            webEvidenceCount: 0,
            webVerificationEnabled: Boolean(process.env.GNEWS_API_KEY),
            aiEnabled: Boolean(process.env.OPENAI_API_KEY),
            extractedTitle: "",
          },
        },
        { status: 400 }
      );
    }

    let text = input;
    let extractionMethod: ExtractionMethod = "raw";
    let sourceDomain = "";
    let extractedTitle = "";

    if (isUrl(input)) {
      const extracted = await extractFromUrl(input);
      extractionMethod = extracted.extractionMethod;
      sourceDomain = extracted.sourceDomain;
      extractedTitle = extracted.extractedTitle;

      if (extracted.text.length > 30) {
        text = extracted.text;
      } else {
        text = [extractedTitle, input].filter(Boolean).join(" ");
      }
    }

    const seed = await buildSearchSeed(text, extractedTitle);
    const lang: "ko" | "en" = isKorean(seed.searchQuery || text) ? "ko" : "en";
    const evidence = await searchGNews(seed.searchQuery || text.slice(0, 100), lang);

    const result = await analyzeWithEvidence({
      inputText: text,
      claim: seed.claim || "",
      coreSummary: seed.coreSummary || "",
      evidence,
      extractionMethod,
      sourceDomain,
      searchQuery: seed.searchQuery || "",
      clickbaitScore: clamp(seed.clickbaitScore || calcClickbaitScore(text)),
      extractedTitle,
    });

    return NextResponse.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : "unknown";

    return NextResponse.json(
      {
        error: "분석 실패",
        detail: message,
        trustScore: 0,
        riskLevel: "높음",
        clickbaitScore: 0,
        verdict: "불확실",
        decision: "비추천",
        summary: "분석 중 오류가 발생했습니다.",
        facts: [],
        cautions: ["링크 처리 중 오류가 발생했지만 앱은 계속 동작합니다."],
        coreSummary: "",
        shareSummary: "",
        evidenceSources: [],
        meta: {
          extractionMethod: "failed" as ExtractionMethod,
          length: 0,
          webEvidenceCount: 0,
          webVerificationEnabled: Boolean(process.env.GNEWS_API_KEY),
          aiEnabled: Boolean(process.env.OPENAI_API_KEY),
          extractedTitle: "",
        },
      },
      { status: 500 }
    );
  }
}