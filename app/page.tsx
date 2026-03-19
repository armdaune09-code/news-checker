"use client";

import { useState } from "react";

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
  verdict?: string;
  decision?: "공유 추천" | "주의" | "비추천";
  summary?: string;
  facts?: string[];
  cautions?: string[];
  coreSummary?: string;
  shareSummary?: string;
  evidenceSources?: EvidenceSource[];
  meta?: {
    sourceDomain?: string;
    extractionMethod?: string;
    length?: number;
    searchQuery?: string;
    webEvidenceCount?: number;
    webVerificationEnabled?: boolean;
  };
  error?: string;
  detail?: string;
};

export default function HomePage() {
  const [input, setInput] = useState("");
  const [result, setResult] = useState<AnalyzeResponse | null>(null);
  const [loading, setLoading] = useState(false);

  const handleAnalyze = async () => {
    if (!input.trim()) {
      setResult({
        error: "링크나 기사, 커뮤니티 글, SNS 글 내용을 입력해 주세요.",
        trustScore: 0,
        riskLevel: "-",
        clickbaitScore: 0,
      });
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

      const rawText = await res.text();

      let data: AnalyzeResponse;
      try {
        data = JSON.parse(rawText);
      } catch {
        throw new Error("서버가 올바른 JSON 응답을 주지 않았습니다.");
      }

      if (!res.ok) {
        throw new Error(data.detail || data.error || "분석 중 오류가 발생했습니다.");
      }

      setResult(data);
    } catch (error) {
      setResult({
        error:
          error instanceof Error
            ? error.message
            : "알 수 없는 오류가 발생했습니다.",
        trustScore: 0,
        riskLevel: "-",
        clickbaitScore: 0,
      });
    } finally {
      setLoading(false);
    }
  };

  const copyText = async (text?: string) => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      alert("복사됐어요.");
    } catch {
      alert("복사에 실패했어요.");
    }
  };

  const getTrustLabel = (score: number) => {
    if (score >= 80) return "높음";
    if (score >= 60) return "보통";
    return "낮음";
  };

  const getTrustColor = (score: number) => {
    if (score >= 80) return "text-green-600";
    if (score >= 60) return "text-yellow-600";
    return "text-red-600";
  };

  const getTrustBarColor = (score: number) => {
    if (score >= 80) return "bg-green-500";
    if (score >= 60) return "bg-yellow-500";
    return "bg-red-500";
  };

  const getClickbaitLabel = (score: number) => {
    if (score >= 70) return "높음";
    if (score >= 40) return "주의";
    return "낮음";
  };

  const getExtractionText = (method?: string) => {
    switch (method) {
      case "readability":
        return "본문 추출 성공";
      case "fallback":
        return "보조 방식 추출";
      case "failed":
        return "링크 분석 실패";
      case "raw":
        return "직접 입력 텍스트";
      default:
        return "-";
    }
  };

  const getDecisionBadge = (decision?: string) => {
    switch (decision) {
      case "공유 추천":
        return "bg-green-100 text-green-700";
      case "주의":
        return "bg-yellow-100 text-yellow-700";
      case "비추천":
        return "bg-red-100 text-red-700";
      default:
        return "bg-gray-100 text-gray-700";
    }
  };

  return (
    <main className="min-h-screen bg-gray-50 px-4 py-10 text-gray-900">
      <div className="mx-auto max-w-4xl">
        <header className="mb-8 text-center">
          <h1 className="text-4xl font-bold tracking-tight">이 글, 진짜인지 판단</h1>
          <p className="mt-4 text-base leading-7 text-gray-600">
            뉴스 링크, 기사 본문, 커뮤니티 글, SNS 글을 입력하면
            <br />
            웹 기사 비교를 포함해 사실 가능성과 핵심 내용을 정리합니다.
          </p>
        </header>

        <section className="rounded-3xl border border-gray-200 bg-white p-5 shadow-sm">
          <label htmlFor="news-input" className="mb-3 block text-sm font-semibold text-gray-700">
            링크 / 기사 / 커뮤니티 글 / SNS 글
          </label>

          <textarea
            id="news-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="뉴스 링크 또는 기사 본문, 커뮤니티 글, SNS 글을 입력하세요"
            className="min-h-[220px] w-full resize-none rounded-2xl border border-gray-300 p-4 text-sm outline-none transition focus:border-black"
          />

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() =>
                setInput("아이브 장원영이 100억대 집을 현금으로 매수했다는 글이 돌고 있다")
              }
              className="rounded-full border border-gray-300 px-3 py-1 text-xs text-gray-600 hover:bg-gray-50"
            >
              연예인 루머 예시
            </button>

            <button
              type="button"
              onClick={() =>
                setInput("충격! 전문가도 경악한 믿을 수 없는 사건 발생... 자세한 내용은 기사 확인 필요")
              }
              className="rounded-full border border-gray-300 px-3 py-1 text-xs text-gray-600 hover:bg-gray-50"
            >
              낚시성 예시
            </button>

            <button
              type="button"
              onClick={() => {
                setInput("");
                setResult(null);
              }}
              className="rounded-full border border-gray-300 px-3 py-1 text-xs text-gray-600 hover:bg-gray-50"
            >
              초기화
            </button>
          </div>

          <div className="mt-5 flex justify-end">
            <button
              type="button"
              onClick={handleAnalyze}
              disabled={loading}
              className="rounded-2xl bg-black px-6 py-3 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? "분석 중..." : "분석하기"}
            </button>
          </div>
        </section>

        {loading && (
          <section className="mt-6 rounded-3xl border border-gray-200 bg-white p-5 shadow-sm">
            <p className="text-sm font-medium text-gray-800">웹 기사 비교 중입니다...</p>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-gray-200">
              <div className="h-full w-1/2 animate-pulse rounded-full bg-black" />
            </div>
          </section>
        )}

        {result?.error && (
          <section className="mt-6 rounded-3xl border border-red-200 bg-red-50 p-5 shadow-sm">
            <h2 className="text-base font-semibold text-red-700">오류</h2>
            <p className="mt-2 text-sm text-red-700">{result.error}</p>
          </section>
        )}

        {result && !result.error && (
          <div className="mt-6 space-y-4">
            <section className="rounded-3xl border border-gray-200 bg-white p-5 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold">분석 결과</h2>
                  <p className="mt-1 text-sm text-gray-500">
                    입력 내용 + 웹 기사 비교 결과입니다.
                  </p>
                </div>

                <div className="flex flex-wrap gap-2">
                  <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-700">
                    {getExtractionText(result.meta?.extractionMethod)}
                  </span>
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-medium ${getDecisionBadge(
                      result.decision
                    )}`}
                  >
                    {result.decision || "-"}
                  </span>
                </div>
              </div>

              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
                  <p className="text-sm text-gray-500">신뢰도</p>
                  <div className="mt-2 flex items-end gap-2">
                    <p className={`text-4xl font-bold ${getTrustColor(result.trustScore)}`}>
                      {result.trustScore}
                    </p>
                    <span className="pb-1 text-lg text-gray-400">%</span>
                  </div>
                  <p className="mt-1 text-sm text-gray-600">
                    수준: {getTrustLabel(result.trustScore)}
                  </p>
                  <div className="mt-4 h-2 overflow-hidden rounded-full bg-gray-200">
                    <div
                      className={`h-full rounded-full ${getTrustBarColor(result.trustScore)}`}
                      style={{ width: `${Math.max(0, Math.min(100, result.trustScore))}%` }}
                    />
                  </div>
                </div>

                <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
                  <p className="text-sm text-gray-500">과장·낚시성 점수</p>
                  <div className="mt-2 flex items-end gap-2">
                    <p className="text-4xl font-bold text-gray-900">{result.clickbaitScore}</p>
                    <span className="pb-1 text-lg text-gray-400">점</span>
                  </div>
                  <p className="mt-1 text-sm text-gray-600">
                    위험도: {getClickbaitLabel(result.clickbaitScore)}
                  </p>
                </div>
              </div>

              <div className="mt-5 rounded-2xl bg-black p-4 text-white">
                <p className="text-xs uppercase tracking-wider text-gray-400">한줄 판단</p>
                <p className="mt-2 text-base font-semibold leading-relaxed">
                  {result.summary || "분석 요약이 없습니다."}
                </p>
              </div>
            </section>

            <section className="rounded-3xl border border-gray-200 bg-white p-5 shadow-sm">
              <h3 className="text-base font-semibold">📌 확인된 내용</h3>
              <ul className="mt-4 space-y-2 text-sm text-gray-700">
                {(result.facts || []).length > 0 ? (
                  result.facts?.map((item, index) => (
                    <li key={index} className="rounded-xl bg-gray-50 px-3 py-2">
                      - {item}
                    </li>
                  ))
                ) : (
                  <li className="rounded-xl bg-gray-50 px-3 py-2">확인된 내용이 부족합니다.</li>
                )}
              </ul>
            </section>

            <section className="rounded-3xl border border-gray-200 bg-white p-5 shadow-sm">
              <h3 className="text-base font-semibold">⚠ 주의</h3>
              <ul className="mt-4 space-y-2 text-sm text-gray-700">
                {(result.cautions || []).length > 0 ? (
                  result.cautions?.map((item, index) => (
                    <li key={index} className="rounded-xl bg-yellow-50 px-3 py-2">
                      - {item}
                    </li>
                  ))
                ) : (
                  <li className="rounded-xl bg-yellow-50 px-3 py-2">특별한 주의 포인트가 없습니다.</li>
                )}
              </ul>
            </section>

            <section className="rounded-3xl border border-gray-200 bg-white p-5 shadow-sm">
              <h3 className="text-base font-semibold">📝 글 핵심 요약</h3>
              <div className="mt-4 rounded-2xl border border-gray-200 bg-gray-50 p-4">
                <p className="text-sm leading-7 text-gray-800">
                  {result.coreSummary || "-"}
                </p>
              </div>
            </section>

            <section className="rounded-3xl border border-gray-200 bg-white p-5 shadow-sm">
              <h3 className="text-base font-semibold">📤 공유용 요약</h3>
              <div className="mt-4 rounded-2xl border border-gray-200 bg-gray-50 p-4">
                <p className="text-sm leading-7 text-gray-800">
                  {result.shareSummary || "-"}
                </p>
                <button
                  type="button"
                  onClick={() => copyText(result.shareSummary)}
                  className="mt-4 rounded-xl border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-white"
                >
                  복사
                </button>
              </div>
            </section>

            <section className="rounded-3xl border border-gray-200 bg-white p-5 shadow-sm">
              <h3 className="text-base font-semibold">📰 웹 근거 기사</h3>
              <div className="mt-4 space-y-3">
                {(result.evidenceSources || []).length > 0 ? (
                  result.evidenceSources?.map((source, index) => (
                    <a
                      key={index}
                      href={source.articleUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="block rounded-2xl border border-gray-200 bg-gray-50 p-4 hover:bg-white"
                    >
                      <p className="text-sm font-semibold text-gray-900">{source.title}</p>
                      <p className="mt-1 text-xs text-gray-500">
                        {source.sourceName} ·{" "}
                        {source.publishedAt
                          ? new Date(source.publishedAt).toLocaleDateString("ko-KR")
                          : ""}
                      </p>
                      {source.description ? (
                        <p className="mt-2 text-sm leading-6 text-gray-700">
                          {source.description}
                        </p>
                      ) : null}
                    </a>
                  ))
                ) : (
                  <div className="rounded-xl bg-gray-50 px-3 py-2 text-sm text-gray-700">
                    웹 근거 기사를 찾지 못했습니다.
                  </div>
                )}
              </div>
            </section>
          </div>
        )}
      </div>
    </main>
  );
}