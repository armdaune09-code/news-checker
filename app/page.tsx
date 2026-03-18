"use client";

import { useEffect, useMemo, useState } from "react";

type CrossCheckItem = {
  source: string;
  status: "일치" | "일부 일치" | "불일치";
  note: string;
};

type AnalysisResult = {
  trustScore: number;
  riskLevel: "낮음" | "중간" | "높음";
  clickbaitScore?: number;
  clickbaitLevel?: "낮음" | "주의" | "높음";
  clickbaitReasons?: string[];
  summary: string;
  verdict: string;
  confirmedFacts: string[];
  uncertainFacts: string[];
  issues: string[];
  crossChecks?: CrossCheckItem[];
  scoreBreakdown?: {
    sourceReliability: number;
    primarySource: number;
    crossVerification: number;
    sensationalism: number;
    evidenceQuality: number;
  };
  exaggeration?: {
    count: number;
    words: string[];
  };
  meta?: {
    extractionUsed?: boolean;
    extractionWarning?: string;
    sourceType?: "url" | "text";
  };
};

function looksLikeUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function extractDomain(value: string) {
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function formatSignedScore(value: number) {
  if (value > 0) return `+${value}`;
  return `${value}`;
}

export default function HomePage() {
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState<AnalysisResult | null>(null);

  const [clipboardUrl, setClipboardUrl] = useState("");
  const [showClipboardBanner, setShowClipboardBanner] = useState(false);

  const [copiedSummary, setCopiedSummary] = useState(false);
  const [copiedShare, setCopiedShare] = useState(false);

  const sourceDomain = useMemo(() => {
    const trimmed = input.trim();
    return looksLikeUrl(trimmed) ? extractDomain(trimmed) : "";
  }, [input]);

  useEffect(() => {
    async function checkClipboard() {
      try {
        if (!navigator.clipboard?.readText) return;
        const text = await navigator.clipboard.readText();
        const trimmed = text.trim();

        if (looksLikeUrl(trimmed)) {
          setClipboardUrl(trimmed);
          setShowClipboardBanner(true);
        }
      } catch (error) {
        console.error("클립보드 읽기 실패:", error);
      }
    }

    checkClipboard();
  }, []);

  async function handleAnalyze() {
    setError("");
    setResult(null);
    setCopiedSummary(false);
    setCopiedShare(false);

    const trimmed = input.trim();
    if (!trimmed) {
      setError("링크나 텍스트를 입력해 주세요.");
      return;
    }

    let timer: ReturnType<typeof setTimeout> | null = null;

    try {
      setLoading(true);
      setLoadingMessage("기사 읽는 중...");

      timer = setTimeout(() => {
        setLoadingMessage("신뢰도 계산 중...");
      }, 700);

      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ input: trimmed }),
      });

      if (timer) clearTimeout(timer);

      let data: AnalysisResult | { error?: string } | null = null;
      try {
        data = await response.json();
      } catch {
        throw new Error("서버 응답을 읽지 못했습니다.");
      }

      if (!response.ok) {
        throw new Error(
          data && "error" in data && data.error
            ? data.error
            : "분석 요청에 실패했습니다."
        );
      }

      setLoadingMessage("결과 정리 중...");
      setResult(data as AnalysisResult);
    } catch (err) {
      console.error(err);
      setError(
        err instanceof Error
          ? err.message
          : "분석 중 문제가 발생했습니다. 다시 시도해 주세요."
      );
    } finally {
      if (timer) clearTimeout(timer);
      setLoading(false);
      setLoadingMessage("");
    }
  }

  async function handlePasteFromClipboard() {
    try {
      const text = await navigator.clipboard.readText();
      setInput(text);
      setError("");
    } catch (error) {
      console.error(error);
      setError("클립보드를 읽지 못했습니다.");
    }
  }

  async function handleCopySummary() {
    if (!result?.summary) return;

    try {
      await navigator.clipboard.writeText(result.summary);
      setCopiedSummary(true);
      setTimeout(() => setCopiedSummary(false), 1500);
    } catch (error) {
      console.error(error);
    }
  }

  const shareText = useMemo(() => {
    if (!result) return "";

    const warningText =
      result.riskLevel === "높음"
        ? "공유 전 재확인이 필요합니다."
        : result.riskLevel === "중간"
        ? "일부 내용은 추가 확인이 필요합니다."
        : "현재 기준 비교적 안정적인 편입니다.";

    const points = result.issues?.length
      ? result.issues.slice(0, 3).map((item) => `- ${item}`).join("\n")
      : "- 추가 체크 포인트 없음";

    return [
      `📊 뉴스 신뢰도: ${result.trustScore}%`,
      `⚠ 위험도: ${result.riskLevel}`,
      typeof result.clickbaitScore === "number"
        ? `🎣 낚시성 위험: ${result.clickbaitScore}% (${result.clickbaitLevel ?? "주의"})`
        : "",
      sourceDomain ? `🌐 출처 도메인: ${sourceDomain}` : "",
      "",
      "🧠 한줄 판단",
      result.summary,
      "",
      "📌 체크 포인트",
      points,
      "",
      "💬 종합",
      warningText,
    ]
      .filter(Boolean)
      .join("\n");
  }, [result, sourceDomain]);

  async function handleCopyShareText() {
    if (!shareText) return;

    try {
      await navigator.clipboard.writeText(shareText);
      setCopiedShare(true);
      setTimeout(() => setCopiedShare(false), 1500);
    } catch (error) {
      console.error(error);
    }
  }

  async function handleNativeShare() {
    if (!shareText) return;

    try {
      if (navigator.share) {
        await navigator.share({
          title: "뉴스 신뢰도 분석 결과",
          text: shareText,
          url: looksLikeUrl(input.trim()) ? input.trim() : undefined,
        });
        return;
      }

      await navigator.clipboard.writeText(shareText);
      setCopiedShare(true);
      setTimeout(() => setCopiedShare(false), 1500);
    } catch (error) {
      console.error(error);
    }
  }

  function getRiskBadgeClass(riskLevel: AnalysisResult["riskLevel"]) {
    if (riskLevel === "낮음") return "bg-green-50 text-green-700";
    if (riskLevel === "중간") return "bg-yellow-50 text-yellow-700";
    return "bg-red-50 text-red-700";
  }

  function getScoreBarClass(score: number) {
    if (score >= 70) return "bg-green-500";
    if (score >= 40) return "bg-yellow-500";
    return "bg-red-500";
  }

  function getBreakdownTextClass(value: number) {
    if (value > 0) return "text-green-700";
    if (value < 0) return "text-red-700";
    return "text-gray-600";
  }

  function getCrossCheckClass(status: CrossCheckItem["status"]) {
    if (status === "일치") return "bg-green-50 text-green-700 border-green-200";
    if (status === "일부 일치") return "bg-yellow-50 text-yellow-700 border-yellow-200";
    return "bg-red-50 text-red-700 border-red-200";
  }

  function getClickbaitBadgeClass(level?: AnalysisResult["clickbaitLevel"]) {
    if (level === "높음") return "bg-red-100 text-red-700";
    if (level === "주의") return "bg-yellow-100 text-yellow-700";
    return "bg-green-100 text-green-700";
  }

  function getClickbaitBarClass(score: number) {
    if (score >= 70) return "bg-red-500";
    if (score >= 40) return "bg-yellow-500";
    return "bg-green-500";
  }

  function getClickbaitLabel(level?: AnalysisResult["clickbaitLevel"]) {
    if (level === "높음") return "낚시 가능성 높음";
    if (level === "주의") return "낚시성 주의";
    return "낚시성 낮음";
  }

  return (
    <main className="min-h-screen bg-white px-6 py-10 text-black">
      <div className="mx-auto max-w-2xl">
        <header>
          <h1 className="text-3xl font-bold tracking-tight">
            이 뉴스, 공유해도 될까?
          </h1>
          <p className="mt-2 text-sm text-gray-600">
            링크나 기사 본문을 넣으면 신뢰도와 주의 포인트를 빠르게 보여줍니다.
          </p>
          <p className="mt-1 text-xs text-gray-500">
            3초 안에 공유 전 판단을 돕는 보조 분석
          </p>
        </header>

        <section className="mt-8">
          {showClipboardBanner && clipboardUrl ? (
            <div className="mb-4 rounded-2xl border border-blue-200 bg-blue-50 p-4">
              <p className="text-sm font-medium text-blue-900">
                클립보드에서 링크를 찾았어요
              </p>
              <p className="mt-1 truncate text-xs text-blue-700">{clipboardUrl}</p>

              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setInput(clipboardUrl);
                    setShowClipboardBanner(false);
                  }}
                  className="rounded-xl bg-black px-3 py-2 text-xs font-semibold text-white"
                >
                  바로 분석하기
                </button>

                <button
                  type="button"
                  onClick={() => setShowClipboardBanner(false)}
                  className="rounded-xl border border-gray-300 bg-white px-3 py-2 text-xs font-medium text-gray-700"
                >
                  닫기
                </button>
              </div>
            </div>
          ) : null}

          <div className="rounded-3xl border border-gray-200 bg-white p-4 shadow-sm">
            <label
              htmlFor="input"
              className="mb-2 block text-sm font-medium text-gray-700"
            >
              뉴스 링크 또는 기사 텍스트
            </label>

            <textarea
              id="input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="뉴스 링크 또는 기사 본문을 붙여넣어 주세요. 가장 정확한 분석을 위해 본문 텍스트를 함께 넣어 주세요."
              className="min-h-[160px] w-full rounded-2xl border border-gray-300 p-4 text-sm outline-none focus:border-black"
            />

            <div className="mt-2 flex flex-wrap items-center gap-2">
              <p className="text-xs text-gray-500">
                링크만 넣는 것보다 기사 본문 텍스트를 함께 붙여넣으면 더 정확합니다.
              </p>
              {sourceDomain ? (
                <span className="rounded-full bg-gray-100 px-2 py-1 text-xs text-gray-700">
                  출처 도메인 {sourceDomain}
                </span>
              ) : null}
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() =>
                  setInput(
                    "속보: 전문가들이 경고한 충격적인 진실! 출처 불명 기사 예시. 일부 주장은 근거가 부족하고 자극적인 표현이 포함되어 있습니다."
                  )
                }
                className="rounded-full border border-gray-300 px-3 py-1 text-xs text-gray-700"
              >
                예시 넣기
              </button>

              <button
                type="button"
                onClick={handlePasteFromClipboard}
                className="rounded-full border border-gray-300 px-3 py-1 text-xs text-gray-700"
              >
                클립보드 붙여넣기
              </button>

              <button
                type="button"
                onClick={() => {
                  setInput("");
                  setError("");
                  setResult(null);
                  setCopiedSummary(false);
                  setCopiedShare(false);
                }}
                className="rounded-full border border-gray-300 px-3 py-1 text-xs text-gray-700"
              >
                초기화
              </button>
            </div>

            <button
              type="button"
              onClick={handleAnalyze}
              disabled={loading}
              className="mt-4 w-full rounded-2xl bg-black px-4 py-3 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? "분석 중..." : "분석하기"}
            </button>

            {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}
          </div>
        </section>

        {loading ? (
          <section className="mt-6 rounded-3xl border border-gray-200 bg-white p-5 shadow-sm">
            <p className="text-sm font-semibold">{loadingMessage || "분석 중..."}</p>
            <div className="mt-4 space-y-3">
              <div className="h-3 w-1/2 animate-pulse rounded bg-gray-200" />
              <div className="h-3 w-2/3 animate-pulse rounded bg-gray-200" />
              <div className="h-3 w-1/3 animate-pulse rounded bg-gray-200" />
            </div>
          </section>
        ) : null}

        {result ? (
          <section className="mt-6 overflow-hidden rounded-3xl border border-gray-200 bg-white shadow-sm">
            <div className="border-b border-gray-100 px-5 py-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">
                Analysis Result
              </p>
              <h2 className="mt-1 text-lg font-bold">뉴스 신뢰도 분석 결과</h2>
            </div>

            <div className="px-5 py-5">
              <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm text-gray-500">신뢰도</p>
                    <div className="mt-2 flex items-end gap-2">
                      <p className="text-5xl font-bold leading-none">
                        {result.trustScore}
                      </p>
                      <span className="pb-1 text-lg font-semibold text-gray-400">
                        %
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-col items-end gap-2">
                    <div
                      className={`rounded-2xl px-4 py-3 text-sm font-semibold ${getRiskBadgeClass(
                        result.riskLevel
                      )}`}
                    >
                      위험도 {result.riskLevel}
                    </div>

                    {sourceDomain ? (
                      <span className="rounded-full border border-gray-200 bg-white px-3 py-1 text-xs text-gray-700">
                        출처 {sourceDomain}
                      </span>
                    ) : null}
                  </div>
                </div>

                <div className="mt-4 h-3 w-full overflow-hidden rounded-full bg-gray-200">
                  <div
                    className={`h-full rounded-full ${getScoreBarClass(
                      result.trustScore
                    )}`}
                    style={{ width: `${result.trustScore}%` }}
                  />
                </div>
              </div>

              <div className="mt-5 rounded-2xl bg-black px-4 py-4 text-white">
                <p className="text-xs uppercase tracking-wider text-gray-400">
                  한줄 판단
                </p>
                <p className="mt-2 text-base font-semibold leading-relaxed">
                  {result.summary}
                </p>

                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={handleCopySummary}
                    className="rounded-xl border border-white/20 px-3 py-2 text-sm font-medium text-white transition hover:bg-white/10"
                  >
                    {copiedSummary ? "복사됨" : "한줄 판단 복사"}
                  </button>

                  <button
                    type="button"
                    onClick={handleCopyShareText}
                    className="rounded-xl border border-white/20 px-3 py-2 text-sm font-medium text-white transition hover:bg-white/10"
                  >
                    {copiedShare ? "복사됨" : "문장 복사"}
                  </button>

                  <button
                    type="button"
                    onClick={handleNativeShare}
                    className="rounded-xl border border-white/20 px-3 py-2 text-sm font-medium text-white transition hover:bg-white/10"
                  >
                    공유하기
                  </button>
                </div>
              </div>

              {typeof result.clickbaitScore === "number" ? (
                <div className="mt-6 rounded-2xl border border-red-200 bg-red-50 p-4">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="text-sm font-semibold text-red-700">
                        🎣 낚시성 위험
                      </p>
                      <div className="mt-2 flex items-end gap-2">
                        <p className="text-4xl font-bold leading-none text-red-700">
                          {result.clickbaitScore}
                        </p>
                        <span className="pb-1 text-base font-semibold text-red-400">
                          %
                        </span>
                      </div>
                    </div>

                    <div
                      className={`rounded-2xl px-4 py-3 text-sm font-semibold ${getClickbaitBadgeClass(
                        result.clickbaitLevel
                      )}`}
                    >
                      {getClickbaitLabel(result.clickbaitLevel)}
                    </div>
                  </div>

                  <div className="mt-4 h-3 w-full overflow-hidden rounded-full bg-red-100">
                    <div
                      className={`h-full rounded-full ${getClickbaitBarClass(
                        result.clickbaitScore
                      )}`}
                      style={{ width: `${result.clickbaitScore}%` }}
                    />
                  </div>

                  {result.clickbaitReasons?.length ? (
                    <div className="mt-4 flex flex-wrap gap-2">
                      {result.clickbaitReasons.map((reason, index) => (
                        <span
                          key={`${reason}-${index}`}
                          className="rounded-full border border-red-200 bg-white px-3 py-2 text-xs text-red-700"
                        >
                          {reason}
                        </span>
                      ))}
                    </div>
                  ) : null}

                  <p className="mt-3 text-xs text-red-600">
                    자극적 표현, 근거 부족, 출처 부족 등을 바탕으로 계산한 보조 지표입니다.
                  </p>
                </div>
              ) : null}

              {shareText ? (
                <div className="mt-6 rounded-2xl border border-purple-200 bg-purple-50 p-4">
                  <p className="text-sm font-semibold text-purple-800">
                    📤 공유용 요약 카드
                  </p>
                  <pre className="mt-3 whitespace-pre-wrap break-words font-sans text-sm leading-relaxed text-purple-900">
                    {shareText}
                  </pre>
                </div>
              ) : null}

              {result.exaggeration && result.exaggeration.count > 0 ? (
                <div className="mt-6 rounded-2xl border border-red-200 bg-red-50 p-4">
                  <p className="text-sm font-semibold text-red-700">
                    ⚠ 자극적 표현 감지
                  </p>

                  <div className="mt-3 flex flex-wrap gap-2">
                    {result.exaggeration.words.map((word, i) => (
                      <span
                        key={`${word}-${i}`}
                        className="rounded-full border border-red-300 bg-white px-2 py-1 text-xs text-red-600"
                      >
                        {word}
                      </span>
                    ))}
                  </div>

                  <p className="mt-2 text-xs text-red-600">
                    자극적인 표현이 많을수록 과장 기사일 가능성이 있습니다.
                  </p>
                </div>
              ) : null}

              {result.crossChecks?.length ? (
                <div className="mt-6 rounded-2xl border border-gray-200 bg-gray-50 p-4">
                  <p className="text-sm font-semibold text-gray-800">🔎 교차 검증</p>
                  <div className="mt-4 space-y-3">
                    {result.crossChecks.map((item, index) => (
                      <div
                        key={`${item.source}-${index}`}
                        className="rounded-2xl border border-gray-200 bg-white p-4"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-semibold text-gray-900">
                            {item.source}
                          </p>
                          <span
                            className={`rounded-full border px-2 py-1 text-xs font-medium ${getCrossCheckClass(
                              item.status
                            )}`}
                          >
                            {item.status}
                          </span>
                        </div>
                        <p className="mt-2 text-sm text-gray-700">{item.note}</p>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {result.scoreBreakdown ? (
                <div className="mt-6 rounded-2xl border border-gray-200 bg-gray-50 p-4">
                  <p className="text-sm font-semibold text-gray-800">📊 점수 세부 항목</p>

                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <div className="rounded-2xl bg-white p-4">
                      <p className="text-xs text-gray-500">출처 신뢰도</p>
                      <p
                        className={`mt-2 text-lg font-bold ${getBreakdownTextClass(
                          result.scoreBreakdown.sourceReliability
                        )}`}
                      >
                        {formatSignedScore(result.scoreBreakdown.sourceReliability)}
                      </p>
                    </div>

                    <div className="rounded-2xl bg-white p-4">
                      <p className="text-xs text-gray-500">1차 출처 여부</p>
                      <p
                        className={`mt-2 text-lg font-bold ${getBreakdownTextClass(
                          result.scoreBreakdown.primarySource
                        )}`}
                      >
                        {formatSignedScore(result.scoreBreakdown.primarySource)}
                      </p>
                    </div>

                    <div className="rounded-2xl bg-white p-4">
                      <p className="text-xs text-gray-500">교차 검증</p>
                      <p
                        className={`mt-2 text-lg font-bold ${getBreakdownTextClass(
                          result.scoreBreakdown.crossVerification
                        )}`}
                      >
                        {formatSignedScore(result.scoreBreakdown.crossVerification)}
                      </p>
                    </div>

                    <div className="rounded-2xl bg-white p-4">
                      <p className="text-xs text-gray-500">과장성</p>
                      <p
                        className={`mt-2 text-lg font-bold ${getBreakdownTextClass(
                          result.scoreBreakdown.sensationalism
                        )}`}
                      >
                        {formatSignedScore(result.scoreBreakdown.sensationalism)}
                      </p>
                    </div>

                    <div className="rounded-2xl bg-white p-4 sm:col-span-2">
                      <p className="text-xs text-gray-500">근거 수준</p>
                      <p
                        className={`mt-2 text-lg font-bold ${getBreakdownTextClass(
                          result.scoreBreakdown.evidenceQuality
                        )}`}
                      >
                        {formatSignedScore(result.scoreBreakdown.evidenceQuality)}
                      </p>
                    </div>
                  </div>

                  <p className="mt-4 text-xs text-gray-500">
                    기본 점수 50점에서 항목별 가점·감점을 반영한 결과입니다.
                  </p>
                </div>
              ) : null}

              <div className="mt-6 rounded-2xl border border-green-200 bg-green-50 p-4">
                <p className="text-sm font-semibold text-green-800">📌 확인된 사실</p>
                <ul className="mt-3 space-y-2 text-sm text-green-900">
                  {result.confirmedFacts?.length ? (
                    result.confirmedFacts.map((fact, index) => (
                      <li key={`${fact}-${index}`}>- {fact}</li>
                    ))
                  ) : (
                    <li>- 현재 확인된 사실이 충분하지 않습니다.</li>
                  )}
                </ul>
              </div>

              <div className="mt-4 rounded-2xl border border-yellow-200 bg-yellow-50 p-4">
                <p className="text-sm font-semibold text-yellow-800">⚠ 불확실 정보</p>
                <ul className="mt-3 space-y-2 text-sm text-yellow-900">
                  {result.uncertainFacts?.length ? (
                    result.uncertainFacts.map((fact, index) => (
                      <li key={`${fact}-${index}`}>- {fact}</li>
                    ))
                  ) : (
                    <li>- 현재 기준 불확실 정보가 두드러지지 않습니다.</li>
                  )}
                </ul>
              </div>

              <div className="mt-4 rounded-2xl border border-blue-200 bg-blue-50 p-4">
                <p className="text-sm font-semibold text-blue-800">🧠 종합 판단</p>
                <p className="mt-2 text-sm leading-relaxed text-blue-900">
                  {result.verdict}
                </p>
              </div>

              <div className="mt-4">
                <p className="text-sm font-medium text-gray-500">체크 포인트</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {result.issues?.map((issue, index) => (
                    <span
                      key={`${issue}-${index}`}
                      className="rounded-full bg-gray-100 px-3 py-2 text-sm text-gray-800"
                    >
                      {issue}
                    </span>
                  ))}
                </div>
              </div>

              {result.meta?.extractionWarning ? (
                <div className="mt-6 rounded-2xl border border-orange-200 bg-orange-50 px-4 py-3">
                  <p className="text-xs font-semibold text-orange-700">안내</p>
                  <p className="mt-1 text-sm text-orange-700">
                    {result.meta.extractionWarning}
                  </p>
                </div>
              ) : null}

              <div className="mt-6 rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3">
                <p className="text-xs font-semibold text-gray-500">주의</p>
                <p className="mt-1 text-sm text-gray-600">
                  이 결과는 정답 판정이 아니라, 틀리지 않기 위한 보조 판단입니다.
                </p>
              </div>
            </div>
          </section>
        ) : null}
      </div>
    </main>
  );
}