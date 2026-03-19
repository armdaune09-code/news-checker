import { NextResponse } from "next/server";
import OpenAI from "openai";
import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";

export const dynamic = "force-dynamic";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

type ExtractionMethod = "readability" | "fallback" | "failed" | "raw";
type Decision = "공유 추천" | "주의" | "비추천";
type Verdict = "사실 가능성 높음" | "불확실" | "허위 가능성 높음";

type EvidenceSource = {
  title: string;
  description: string;
  articleUrl: string;
  sourceName: string;
  sourceUrl: string;
  publishedAt: string;
};

function clamp(n: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Math.round(n)));
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

function getRiskLevel(score: number) {
  if (score >= 80) return "낮음";
  if (score >= 60) return "중간";
  return "높음";
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
- 한국어 입력이면 한국어로

분석 대상:
${text.slice(0, 3500)}
`;

  const resp = await openai.responses.create({
    model: "gpt-4.1-mini",
    input: prompt,
  });

  return safeJsonParse<{
    claim: string;
    searchQuery: string;
    coreSummary: string;
    clickbaitScore: number;
  }>(resp.output_text || "{}", {
    claim: text.slice(0, 100),
    searchQuery: text.slice(0, 100),
    coreSummary: text.slice(0, 180),
    clickbaitScore: 20,
  });
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
  clickbaitScore: number;
  evidence: EvidenceSource[];
  extractionMethod: ExtractionMethod;
  sourceDomain: string;
}) {
  const evidenceText =
    args.evidence.length > 0
      ? args.evidence
          .map(
            (e, i) =>
              `${i + 1}. [${e.sourceName}] ${e.title} | ${e.description} | ${e.publishedAt} | ${e.articleUrl}`
          )
          .join("\n")
      : "검색된 관련 기사 없음";

  const prompt = `
너는 "웹 근거 기반 뉴스 검증기"다.
입력 글과 웹 기사들을 비교해서 결과를 JSON만 출력해라.

형식:
{
  "trustScore": 0,
  "verdict": "사실 가능성 높음 | 불확실 | 허위 가능성 높음",
  "decision": "공유 추천 | 주의 | 비추천",
  "summary": "공유 전 판단용 한줄 결론",
  "facts": ["확인된 내용 1", "확인된 내용 2"],
  "cautions": ["주의 포인트 1", "주의 포인트 2"],
  "shareSummary": "사람이 그대로 복사해 공유할 수 있는 자연스러운 뉴스형 1~2문장 요약"
}

규칙:
- summary는 판정 한줄
- shareSummary는 사건 내용을 요약해야지 분석 설명을 쓰면 안 된다
- facts는 웹 기사로 확인되는 내용 중심
- cautions는 추정/불일치/출처 부족 같은 부분
- 과장되거나 단정적인 말투 금지
- 최대한 자연스러운 한국어

입력 주장:
${args.claim}

입력 글 핵심 요약:
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

  return safeJsonParse<{
    trustScore: number;
    verdict: Verdict;
    decision: Decision;
    summary: string;
    facts: string[];
    cautions: string[];
    shareSummary: string;
  }>(resp.output_text || "{}", {
    trustScore: 50,
    verdict: "불확실",
    decision: "주의",
    summary: "입력 내용만으로는 사실 여부를 단정하기 어렵습니다.",
    facts: [],
    cautions: [],
    shareSummary: args.coreSummary || "핵심 요약을 만들지 못했습니다.",
  });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const input = typeof body?.input === "string" ? body.input.trim() : "";

    if (!input) {
      return NextResponse.json({ error: "입력값 없음" }, { status: 400 });
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

    const analyzed = await analyzeWithEvidence({
      inputText: text,
      claim: seed.claim || "",
      coreSummary: seed.coreSummary || "",
      clickbaitScore: clamp(seed.clickbaitScore || 0),
      evidence,
      extractionMethod,
      sourceDomain,
    });

    const trustScore = clamp(analyzed.trustScore || 50);
    const clickbaitScore = clamp(seed.clickbaitScore || 0);

    return NextResponse.json({
      trustScore,
      riskLevel: getRiskLevel(trustScore),
      clickbaitScore,
      verdict: analyzed.verdict || "불확실",
      decision: analyzed.decision || "주의",
      summary: analyzed.summary || "추가 확인이 필요합니다.",
      facts: Array.isArray(analyzed.facts) ? analyzed.facts.slice(0, 4) : [],
      cautions: Array.isArray(analyzed.cautions)
        ? analyzed.cautions.slice(0, 4)
        : [],
      coreSummary: seed.coreSummary || "",
      shareSummary: analyzed.shareSummary || seed.coreSummary || "",
      evidenceSources: evidence.slice(0, 5),
      meta: {
        sourceDomain,
        extractionMethod,
        length: text.length,
        searchQuery: seed.searchQuery || "",
        webEvidenceCount: evidence.length,
        webVerificationEnabled: Boolean(process.env.GNEWS_API_KEY),
      },
    });
  } catch (e) {
    return NextResponse.json(
      {
        error: "분석 실패",
        detail: e instanceof Error ? e.message : "unknown",
      },
      { status: 500 }
    );
  }
}