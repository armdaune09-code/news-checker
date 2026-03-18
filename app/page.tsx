"use client";

import { useState } from "react";

type AnalyzeResponse = {
  trustScore: number;
  riskLevel: string;
  clickbaitScore: number;
  meta?: {
    sourceDomain?: string;
    extractedTitle?: string;
    extractionConfidence?: "high" | "medium" | "low";
    extractionMethod?: "readability" | "body-fallback" | "raw-input" | "failed";
    extractedLength?: number;
    usedFallbackInput?: boolean;
  };
  summary?: string;
  warnings?: string[];
  error?: string;
  detail?: string;
};

export default function HomePage() {
  const [input, setInput] = useState("");
  const [result, setResult] = useState<AnalyzeResponse | null>(null);
  const [loading, setLoading] = useState(false);

  const handleAnalyze = async () => {
    if (!input.trim()) {
      alert("링크, 기사 제목, 또는 본문을 입력해주세요.");
      return;
    }

    try {
      setLoading(true);
      setResult(null);

      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ input }),
      });

      const data = await res.json();

      if (!res.ok) {
        setResult({
          error: data?.error || "분석 요청 실패",
          detail: data?.detail || "",
          trustScore: 0,
          riskLevel: "알 수 없음",
          clickbaitScore: 0,
        });
        return;
      }

      setResult(data);
    } catch (error) {
      setResult({
        error: "분석 중 오류가 발생했습니다.",
        detail: error instanceof Error ? error.message : "unknown error",
        trustScore: 0,
        riskLevel: "알 수 없음",
        clickbaitScore: 0,
      });
    } finally {
      setLoading(false);
    }
  };

  const getTrustLabel = (score?: number) => {
    if (typeof score !== "number") return "알 수 없음";
    if (score >= 80) return "높음";
    if (score >= 60) return "중간";
    return "낮음";
  };

  const getTrustTextColor = (score?: number) => {
    if (typeof score !== "number") return "text-gray-500";
    if (score >= 80) return "text-green-600";
    if (score >= 60) return "text-yellow-600";
    return "text-red-600";
  };

  const getTrustBarColor = (score?: number) => {
    if (typeof score !== "number") return "bg-gray-300";
    if (score >= 80) return "bg-green-500";
    if (score >= 60) return "bg-yellow-500";
    return "bg-red-500";
  };

  const getClickbaitLabel = (score?: number) => {
    if (typeof score !== "number") return "알 수 없음";
    if (score >= 70) return "높음";
    if (score >= 40) return "주의";
    return "낮음";
  };

  const getClickbaitBadge = (score?: number) => {
    if (typeof score !== "number") return "bg-gray-100 text-gray-600";
    if (score >= 70) return "bg-red-100 text-red-700";
    if (score >= 40) return "bg-yellow-100 text-yellow-700";
    return "bg-green-100 text-green-700";
  };

  const getExtractionBadge = (confidence?: string) => {
    switch (confidence) {
      case "high":
        return {
          text: "본문 추출 정확도 높음",
          className: "bg-green-100 text-green-700",
        };
      case "medium":
        return {
          text: "본문 추출 정확도 중간",
          className: "bg-yellow-100 text-yellow-700",
        };
      case "low":
        return {
          text: "본문 추출 정확도 낮음",
          className: "bg-red-100 text-red-700",
        };
      default:
        return {
          text: "추출 정보 없음",
          className: "bg-gray-100 text-gray-600",
        };
    }
  };

  const extractionBadge = getExtractionBadge(result?.meta?.extractionConfidence);

  return (
    <main className="min-h-screen bg-white px-5 py-10 text-gray-900">
      <div className="mx-auto max-w-3xl">
        <header className="text-center">
          <h1 className="text-3xl font-bold tracking-tight">이 뉴스, 공유해도 될까?</h1>
          <p className="mt-3 text-sm leading-6 text-gray-500">
            뉴스 링크, 기사 제목, 기사 본문을 입력하면
            <br />
            신뢰도와 낚시성 위험을 빠르게 분석합니다.
          </p>
          <p className="mt-2 text-xs text-gray-400">
            가장 정확한 분석은 기사 본문 기준입니다.
          </p>
        </header>

        <section className="mt-8 rounded-3xl border border-gray-200 bg-white p-4 shadow-sm">
          <label htmlFor="input" className="mb-2 block text-sm font-medium text-gray-700">
            뉴스 링크 / 제목 / 기사 본문
          </label>

          <textarea
            id="input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="뉴스 링크, 기사 제목, 또는 기사 본문을 입력하세요"
            className="min-h-[180px] w-full resize-none rounded-2xl border border-gray-300 p-4 text-sm outline-none focus:border-black"
          />

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() =>
                setInput("대구 놀이터서 총 맞은 초등생... 목에 탄두 추정 물체 발견")
              }
              className="rounded-full border border-gray-300 px-3 py-1 text-xs text-gray-700"
            >
              예시 제목 넣기
            </button>

            <button
              type="button"
              onClick={() =>
                setInput(
                  "충격! 전문가도 경악한 믿을 수 없는 사건 발생... 자세한 내용은 기사 확인 필요"
                )
              }
              className="rounded-full border border-gray-300 px-3 py-1 text-xs text-gray-700"
            >
              낚시성 예시 넣기
            </button>

            <button
              type="button"
              onClick={() => {
                setInput("");
                setResult(null);
              }}
              className="rounded-full border border-gray-300 px-3 py-1 text-xs text-gray-700"
            >
              초기화
            </button>
          </div>

          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-gray-500">
              링크는 일부 사이트에서 본문 추출 정확도가 낮을 수 있습니다.
            </p>

            <button
              onClick={handleAnalyze}
              disabled={loading}
              className="rounded-2xl bg-black px-5 py-3 text-sm font-medium text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? "분석 중..." : "분석하기"}
            </button>
          </div>
        </section>

        {loading && (
          <section className="mt-6 rounded-3xl border border-gray-200 bg-gray-50 p-5 shadow-sm">
            <p className="text-sm font-medium text-gray-800">분석 중...</p>
            <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-gray-200">
              <div className="h-full w-1/2 animate-pulse rounded-full bg-black" />
            </div>
            <p className="mt-3 text-sm text-gray-500">
              링크일 경우 본문 추출 상태에 따라 정확도가 달라질 수 있습니다.
            </p>
          </section>
        )}

        {result && !result.error && (
          <div className="mt-6 space-y-4">
            {result.meta?.usedFallbackInput && (
              <section className="rounded-2xl border border-yellow-200 bg-yellow-50 p-5 shadow-sm">
                <p className="text-sm font-semibold text-yellow-800">
                  ⚠ 본문 추출이 충분하지 않아 입력값 기준으로 분석했습니다
                </p>
                <p className="mt-2 text-sm leading-6 text-yellow-900">
                  포털(MSN/네이버/다음) 또는 일부 뉴스 사이트는 자동으로 기사 본문을
                  완전히 읽지 못할 수 있어요.
                </p>
                <ul className="mt-3 ml-5 list-disc space-y-1 text-sm text-yellow-900">
                  <li>기사 본문을 직접 붙여넣으면 더 정확합니다.</li>
                  <li>원문 기사 링크를 넣으면 성공률이 더 높습니다.</li>
                </ul>
              </section>
            )}

            <section className="rounded-3xl border border-gray-200 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold">분석 결과</h2>
                  <p className="mt-1 text-sm text-gray-500">
                    현재 확인 가능한 정보 기준 보조 분석입니다.
                  </p>
                </div>

                <span className={`rounded-full px-3 py-1 text-xs font-medium ${extractionBadge.className}`}>
                  {extractionBadge.text}
                </span>
              </div>

              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
                  <p className="text-sm text-gray-500">신뢰도 점수</p>
                  <div className="mt-2 flex items-end gap-2">
                    <p className={`text-4xl font-bold ${getTrustTextColor(result.trustScore)}`}>
                      {result.trustScore}
                    </p>
                    <span className="pb-1 text-lg font-semibold text-gray-400">점</span>
                  </div>
                  <p className="mt-1 text-sm text-gray-600">
                    신뢰 수준: {getTrustLabel(result.trustScore)}
                  </p>
                  <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-gray-200">
                    <div
                      className={`h-full rounded-full ${getTrustBarColor(result.trustScore)}`}
                      style={{ width: `${result.trustScore}%` }}
                    />
                  </div>
                </div>

                <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
                  <p className="text-sm text-gray-500">낚시성 점수</p>
                  <div className="mt-2 flex items-end gap-2">
                    <p className="text-4xl font-bold text-gray-900">{result.clickbaitScore}</p>
                    <span className="pb-1 text-lg font-semibold text-gray-400">점</span>
                  </div>
                  <div className="mt-2">
                    <span
                      className={`rounded-full px-3 py-1 text-xs font-medium ${getClickbaitBadge(
                        result.clickbaitScore
                      )}`}
                    >
                      낚시성 위험 {getClickbaitLabel(result.clickbaitScore)}
                    </span>
                  </div>
                  <p className="mt-2 text-sm text-gray-600">위험도: {result.riskLevel}</p>
                </div>
              </div>

              {result.summary && (
                <div className="mt-5 rounded-2xl bg-black p-4 text-white">
                  <p className="text-xs uppercase tracking-wider text-gray-400">한줄 판단</p>
                  <p className="mt-2 text-base font-semibold leading-relaxed">{result.summary}</p>
                </div>
              )}

              {result.warnings && result.warnings.length > 0 && (
                <div className="mt-5 rounded-2xl border border-yellow-200 bg-yellow-50 p-4">
                  <p className="text-sm font-medium text-yellow-900">주의사항</p>
                  <ul className="mt-2 space-y-1 text-sm text-yellow-900">
                    {result.warnings.map((warning, idx) => (
                      <li key={idx}>• {warning}</li>
                    ))}
                  </ul>
                </div>
              )}
            </section>

            <section className="rounded-3xl border border-gray-200 bg-white p-5 shadow-sm">
              <h3 className="text-base font-semibold">추출 정보</h3>

              <div className="mt-4 space-y-3 text-sm text-gray-700">
                <div className="flex flex-col gap-1 sm:flex-row sm:gap-3">
                  <span className="font-medium text-gray-900">출처:</span>
                  <span>{result.meta?.sourceDomain || "-"}</span>
                </div>

                <div className="flex flex-col gap-1 sm:flex-row sm:gap-3">
                  <span className="font-medium text-gray-900">추출 제목:</span>
                  <span>{result.meta?.extractedTitle || "-"}</span>
                </div>

                <div className="flex flex-col gap-1 sm:flex-row sm:gap-3">
                  <span className="font-medium text-gray-900">본문 추출 상태:</span>
                  <span>{extractionBadge.text}</span>
                </div>

                <div className="flex flex-col gap-1 sm:flex-row sm:gap-3">
                  <span className="font-medium text-gray-900">추출 방식:</span>
                  <span>{result.meta?.extractionMethod || "-"}</span>
                </div>

                <div className="flex flex-col gap-1 sm:flex-row sm:gap-3">
                  <span className="font-medium text-gray-900">추출 길이:</span>
                  <span>
                    {typeof result.meta?.extractedLength === "number"
                      ? `${result.meta.extractedLength}자`
                      : "-"}
                  </span>
                </div>
              </div>
            </section>
          </div>
        )}

        {result?.error && (
          <section className="mt-6 rounded-2xl border border-red-200 bg-red-50 p-5">
            <h2 className="text-base font-semibold text-red-700">오류</h2>
            <p className="mt-2 text-sm text-red-700">{result.error}</p>
            {result.detail && (
              <p className="mt-1 text-sm text-red-600">상세: {result.detail}</p>
            )}
          </section>
        )}
      </div>
    </main>
  );
}