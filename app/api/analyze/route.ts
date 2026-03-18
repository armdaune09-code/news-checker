import { NextResponse } from "next/server";
import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";

function cleanText(text: string) {
  return text
    .replace(/\s+/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .trim();
}

function extractOgTitle(html: string) {
  const ogMatch = html.match(
    /<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["'][^>]*>/i
  );
  if (ogMatch?.[1]) return cleanText(ogMatch[1]);

  const titleMatch = html.match(/<title[^>]*>(.*?)<\/title>/i);
  if (titleMatch?.[1]) return cleanText(titleMatch[1]);

  return "";
}

function getRiskLevel(score: number) {
  if (score >= 80) return "낮음";
  if (score >= 60) return "중간";
  return "높음";
}

function clamp(num: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, num));
}

export async function POST(req: Request) {
  try {
    const { input } = await req.json();

    if (!input || typeof input !== "string" || !input.trim()) {
      return NextResponse.json(
        { error: "입력이 없습니다." },
        { status: 400 }
      );
    }

    const trimmedInput = input.trim();

    let extractedText = "";
    let extractedTitle = "";
    let sourceDomain = "";
    let extractionConfidence: "high" | "medium" | "low" = "low";
    let extractionMethod:
      | "readability"
      | "body-fallback"
      | "raw-input"
      | "failed" = "raw-input";

    const isUrl = /^https?:\/\//i.test(trimmedInput);

    if (isUrl) {
      try {
        const url = new URL(trimmedInput);
        sourceDomain = url.hostname.replace(/^www\./, "");

        const res = await fetch(trimmedInput, {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
            Accept:
              "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
            "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
            "Cache-Control": "no-cache",
          },
          redirect: "follow",
        });

        if (!res.ok) {
          throw new Error(`본문 요청 실패: ${res.status}`);
        }

        const html = await res.text();
        extractedTitle = extractOgTitle(html);

        // 1차: Readability 본문 추출
        try {
          const dom = new JSDOM(html, { url: trimmedInput });
          const reader = new Readability(dom.window.document);
          const article = reader.parse();

          if (article?.textContent) {
            extractedText = cleanText(article.textContent);
            if (!extractedTitle && article.title) {
              extractedTitle = cleanText(article.title);
            }
            extractionMethod = "readability";
          }
        } catch {
          // readability 실패 시 아래 fallback 진행
        }

        // 2차 fallback: body 텍스트 추출
        if (!extractedText || extractedText.length < 300) {
          const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
          const bodyRaw = bodyMatch ? bodyMatch[1] : "";

          const bodyClean = cleanText(
            bodyRaw
              .replace(/<script[\s\S]*?<\/script>/gi, " ")
              .replace(/<style[\s\S]*?<\/style>/gi, " ")
              .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
              .replace(/<iframe[\s\S]*?<\/iframe>/gi, " ")
              .replace(/<[^>]+>/g, " ")
          );

          if (bodyClean.length > extractedText.length) {
            extractedText = bodyClean;
            extractionMethod = "body-fallback";
          }
        }

        // 신뢰도 판단
        if (extractedText.length > 3000) {
          extractionConfidence = "high";
        } else if (extractedText.length > 1000) {
          extractionConfidence = "medium";
        } else {
          extractionConfidence = "low";
        }
      } catch (e) {
        extractedText = "";
        extractedTitle = "";
        extractionConfidence = "low";
        extractionMethod = "failed";
      }
    } else {
      extractedText = trimmedInput;
      extractionConfidence = "high";
      extractionMethod = "raw-input";
    }

    const analysisText =
      extractedText && extractedText.length > 300 ? extractedText : trimmedInput;

    // 낚시성 키워드 점수
    let clickbaitScore = 0;
    const baitKeywords = [
      "충격",
      "경악",
      "헉",
      "논란",
      "대박",
      "미쳤다",
      "소름",
      "실화",
      "결국",
      "드디어",
      "폭로",
      "단독",
      "반전",
      "역대급",
      "초비상",
    ];

    for (const word of baitKeywords) {
      if (analysisText.includes(word)) {
        clickbaitScore += 8;
      }
    }

    // 제목에 낚시 키워드가 있으면 가중치
    for (const word of baitKeywords) {
      if (extractedTitle.includes(word) || trimmedInput.includes(word)) {
        clickbaitScore += 6;
      }
    }

    clickbaitScore = clamp(clickbaitScore);

    // 신뢰도 점수
    let trustScore = 75;

    if (extractionConfidence === "medium") trustScore -= 8;
    if (extractionConfidence === "low") trustScore -= 18;

    if (clickbaitScore >= 50) trustScore -= 12;
    else if (clickbaitScore >= 30) trustScore -= 6;

    // 텍스트가 너무 짧으면 신뢰도 추가 하락
    if (analysisText.length < 200) trustScore -= 20;
    else if (analysisText.length < 500) trustScore -= 10;

    trustScore = clamp(trustScore);

    return NextResponse.json({
      trustScore,
      riskLevel: getRiskLevel(trustScore),
      clickbaitScore,

      meta: {
        sourceDomain,
        extractedTitle,
        extractionConfidence,
        extractionMethod,
        extractedLength: extractedText.length,
        usedFallbackInput: !(extractedText && extractedText.length > 300),
      },

      summary:
        extractionMethod === "readability"
          ? "기사 본문 추출 후 분석되었습니다."
          : extractionMethod === "body-fallback"
          ? "본문 추출 정확도가 낮아 페이지 텍스트 기반으로 분석되었습니다."
          : extractionMethod === "raw-input"
          ? "입력된 텍스트 기준으로 분석되었습니다."
          : "⚠ 링크 본문 추출에 실패하여 입력값 기준으로 분석되었습니다.",

      warnings:
        extractionConfidence === "low"
          ? [
              "링크 본문 추출 정확도가 낮습니다.",
              "정확한 분석을 위해 기사 본문을 직접 붙여넣는 방식이 더 안정적입니다.",
            ]
          : [],
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