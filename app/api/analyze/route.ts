import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const input = String(body?.input ?? "").trim();

    if (!input) {
      return NextResponse.json(
        { error: "입력값 없음" },
        { status: 400 }
      );
    }

    return NextResponse.json({
      trustScore: 60,
      riskLevel: "중간",
      clickbaitScore: 50,
      clickbaitLevel: "주의",
      clickbaitReasons: ["테스트 데이터"],
      summary: "테스트 분석",
      verdict: "정상 작동 확인용",
      confirmedFacts: ["입력값 존재"],
      uncertainFacts: [],
      issues: [],
      crossChecks: [],
      scoreBreakdown: {
        sourceReliability: 0,
        primarySource: 0,
        crossVerification: 0,
        sensationalism: 0,
        evidenceQuality: 0
      },
      exaggeration: {
        count: 0,
        words: []
      },
      meta: {
        extractionUsed: false,
        extractionWarning: "",
        extractionConfidence: "높음",
        sourceType: "text",
        sourceDomain: "",
        extractedTitle: "",
        extractor: "test"
      }
    });

  } catch (error) {
    return NextResponse.json(
      { error: "에러 발생" },
      { status: 500 }
    );
  }
}