import { NextResponse } from "next/server";
import OpenAI from "openai";
import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";

export const dynamic = "force-dynamic";

type ExtractionMethod = "readability" | "fallback" | "failed" | "raw";
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

function isUrl(text: string) {
  return /^https?:\/\//i.test(text);
}

function isKorean(text: string) {
  return /[가-힣]/.test(text);
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

function calcClickbaitScore(text: string) {
  const keywords = [
    "충격",
    "단독",
    "경악",
    "난리",
    "대박",
    "전액 현금",
    "100억",
    "역대급",
    "결국",
    "실화",
    "반전",
    "폭로",
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
  if (cleaned.length <= 120) return cleaned;
  return `${cleaned.slice(0, 117)}...`;
}

function fallbackShareSummary(text: string) {
  const cleaned = cleanText(text);
  if (cleaned.length <= 160) return cleaned;
  return `${cleaned.slice(0, 157)}...`;
}

function fallbackAnalyze(
  text: string,
  sourceDomain = "",
  extractionMethod: ExtractionMethod = "raw",
  evidenceSources: EvidenceSource[] = [],
  searchQuery = ""
): AnalyzeResponse {
  const clickbaitScore = calcClickbaitScore(text);

  let trustScore = 55;
  const facts: string[] = [];
  const cautions: string[] = [];

  if (text.length > 500) {
    trustScore += 10;
    facts.push("분석 가능한 텍스트 길이가 확보됨");
  } else if (text.length < 80) {
    trustScore -= 20;
    cautions.push("입력 텍스트가 너무 짧음");
  }

  if (sourceDomain) {
    facts.push(`출처 도메인 확인: ${sourceDomain}`);
  } else {
    cautions.push("출처 정보가 없음");
  }

  if (evidenceSources.length > 0) {
    trustScore += 15;
    facts.push(`관련 웹 기사 ${evidenceSources.length}건 발견`);
  } else {
    cautions.push("관련 웹 기사 근거를 충분히 찾지 못함");
  }

  if (clickbaitScore >= 40) {
    trustScore -= 15;
    cautions.push("자극적 표현 가능성 높음");
  }

  trustScore = clamp(trustScore);

  let verdict: Verdict = "불확실";
  if (trustScore >= 75) verdict = "사실 가능성 높음";
  else if (trustScore < 40) verdict = "허위 가능성 높음";

  let decision: Decision = "주의";
  if (trustScore >= 80 && clickbaitScore < 35) decision = "공유 추천";
  else if (trustScore < 50) decision = "비추천";

  const coreSummary = fallbackCoreSummary(text);
  const shareSummary =
    evidenceSources.length > 0
      ? `${evidenceSources[0].title}`
      : fallbackShareSummary(text);

  return {
    trustScore,
    riskLevel: getRiskLevel(trustScore),
    clickbaitScore,
    verdict,
    decision,
    summary:
      verdict === "사실 가능성 높음"
        ? "현재 기준 관련 기사 근거가 일부 확인됩니다."
        : verdict === "허위 가능성 높음"
        ? "현재 기준 근거가 약해 그대로 믿기엔 위험합니다."
        : "추가 확인이 필요한 정보입니다.",
    facts,
    cautions,
    coreSummary,
    shareSummary,
    evidenceSources,
    meta: {
      sourceDomain,
      extractionMethod,
      length: text.length,
      searchQuery,
      webEvidenceCount: evidenceSources.length,
      webVerificationEnabled: Boolean(process.env.GNEWS_API_KEY),
      aiEnabled: Boolean(process.env.OPENAI_API_KEY),
    },
  };
}

async function extractFromUrl(url: string): Promise<{
  text: string;
  extractionMethod: ExtractionMethod;
  sourceDomain: string;
}> {
  let sourceDomain = "";
  try {
    sourceDomain = new URL(url).hostname.replace(/^www\./, "");
  } catch {
    sourceDomain = "";
  }

  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      },
      redirect: "follow",
      cache: "no-store",
    });

    if (!res.ok) {
      return { text: "", extractionMethod: "failed", sourceDomain };
    }

    const html = await res.text();

    try {
      const dom = new JSDOM(html, { url });
      const reader = new Readability(dom.window.document);
      const article = reader.parse();

      if (article?.textContent && article.textContent.trim().length > 300) {
        return {
          text: cleanText(article.textContent),
          extractionMethod: "readability",
          sourceDomain,
        };
      }
    } catch {
      // ignore
    }

    const fallbackText = cleanText(html);
    if (fallbackText.length > 600) {
      return {
        text: fallbackText,
        extractionMethod: "fallback",
        sourceDomain,
      };
    }

    return { text: "", extractionMethod: "failed", sourceDomain };
  } catch {
    return { text: "", extractionMethod: "failed", sourceDomain };
  }
}

async function buildSearchSeed(text: string) {
  if (!openai) {
    return {
      claim: fallbackCoreSummary(text),
      searchQuery: fallbackCoreSummary(text).slice(0, 60),
      coreSummary: fallbackCoreSummary(text),
      clickbaitScore: calcClickbaitScore(text),
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
${text.slice(0, 3500)}
`;

    const resp = await openai.responses.create({
      model: "gpt-4.1-mini",
      input: prompt,
    });

    return safeJsonParse(resp.output_text || "{}", {
      claim: fallbackCoreSummary(text),
      searchQuery: fallbackCoreSummary(text).slice(0, 60),
      coreSummary: fallbackCoreSummary(text),
      clickbaitScore: calcClickbaitScore(text),
    });
  } catch {
    return {
      claim: fallbackCoreSummary(text),
      searchQuery: fallbackCoreSummary(text).slice(0, 60),
      coreSummary: fallbackCoreSummary(text),
      clickbaitScore: calcClickbaitScore(text),
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
}): Promise<AnalyzeResponse> {
  if (!openai) {
    return fallbackAnalyze(
      args.inputText,
      args.sourceDomain,
      args.extractionMethod,
      args.evidence,
      args.searchQuery
    );
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
- shareSummary는 분석 설명이 아니라 사건 내용을 자연스럽게 요약
- facts는 웹 기사로 확인되는 내용 중심
- cautions는 추정/불일치/출처 부족 같은 부분
- 최대한 자연스러운 한국어
- 빈 배열 가능

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
      shareSummary: fallbackShareSummary(args.inputText),
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
        parsed.shareSummary || args.coreSummary || fallbackShareSummary(args.inputText),
      evidenceSources: args.evidence.slice(0, 5),
      meta: {
        sourceDomain: args.sourceDomain,
        extractionMethod: args.extractionMethod,
        length: args.inputText.length,
        searchQuery: args.searchQuery,
        webEvidenceCount: args.evidence.length,
        webVerificationEnabled: Boolean(process.env.GNEWS_API_KEY),
        aiEnabled: true,
      },
    };
  } catch {
    return fallbackAnalyze(
      args.inputText,
      args.sourceDomain,
      args.extractionMethod,
      args.evidence,
      args.searchQuery
    );
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
          },
        },
        { status: 400 }
      );
    }

    let text = input;
    let extractionMethod: ExtractionMethod = "raw";
    let sourceDomain = "";

    if (isUrl(input)) {
      const extracted = await extractFromUrl(input);
      extractionMethod = extracted.extractionMethod;
      sourceDomain = extracted.sourceDomain;

      if (extracted.text.length > 200) {
        text = extracted.text;
      }
    }

    const seed = await buildSearchSeed(text);
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
        },
      },
      { status: 500 }
    );
  }
}