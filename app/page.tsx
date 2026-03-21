"use client";

import { useEffect, useMemo, useState } from "react";

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
    aiEnabled?: boolean;
    extractedTitle?: string;
  };
  error?: string;
  detail?: string;
};

type HistoryItem = {
  id: string;
  input: string;
  createdAt: string;
  result: AnalyzeResponse;
};

const HISTORY_KEY = "news-checker-history-v1";

function getTrustLabel(score: number) {
  if (score >= 80) return "높음";
  if (score >= 60) return "보통";
  return "낮음";
}

function getTrustColor(score: number) {
  if (score >= 80) return "text-green-600";
  if (score >= 60) return "text-yellow-600";
  return "text-red-600";
}

function getTrustBarColor(score: number) {
  if (score >= 80) return "bg-green-500";
  if (score >= 60) return "bg-yellow-500";
  return "bg-red-500";
}

function getTrustBg(score: number) {
  if (score >= 80) return "bg-green-50 border-green-200";
  if (score >= 60) return "bg-yellow-50 border-yellow-200";
  return "bg-red-50 border-red-200";
}

function getClickbaitLabel(score: number) {
  if (score >= 70) return "높음";
  if (score >= 40) return "주의";
  return "낮음";
}

function getClickbaitColor(score: number) {
  if (score >= 70) return "text-red-600";
  if (score >= 40) return "text-yellow-600";
  return "text-green-600";
}

function getClickbaitBarColor(score: number) {
  if (score >= 70) return "bg-red-500";
  if (score >= 40) return "bg-yellow-500";
  return "bg-green-500";
}

function getExtractionText(method?: string) {
  switch (method) {
    case "naver-selector":
      return "네이버 본문 추출";
    case "readability":
      return "본문 추출 성공";
    case "fallback":
    case "body-fallback":
      return "보조 방식 추출";
    case "meta-fallback":
      return "제목/설명 기반";
    case "failed":
      return "링크 분석 실패";
    case "raw":
      return "직접 입력 텍스트";
    default:
      return "-";
  }
}

function getDecisionBadge(decision?: string) {
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
}

function extractKeywords(text: string) {
  const stopwords = new Set([
    "그리고",
    "그러나",
    "하지만",
    "관련",
    "현재",
    "기준",
    "통해",
    "대한",
    "있다",
    "있으며",
    "한다",
    "했다",
    "되는",
    "에서",
    "으로",
    "이다",
    "라고",
    "했다는",
    "보도가",
    "내용",
    "기사",
    "뉴스",
    "확인",
    "추정",
    "가능성",
    "사실",
    "정보",
    "위한",
    "기반",
    "일부",
    "대한한",
    "정도",
    "이번",
  ]);

  const matches = text.match(/[가-힣A-Za-z0-9·.-]{2,}/g) || [];
  const counts = new Map<string, number>();

  for (const word of matches) {
    const normalized = word.trim();
    if (
      normalized.length < 2 ||
      stopwords.has(normalized) ||
      /^[0-9]+$/.test(normalized)
    ) {
      continue;
    }
    counts.set(normalized, (counts.get(normalized) || 0) + 1);
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([word]) => word)
    .slice(0, 5);
}

function getSourceTrustLabel(url?: string, sourceName?: string) {
  const raw = `${url || ""} ${sourceName || ""}`.toLowerCase();

  const major = [
    "yna.co.kr",
    "kbs",
    "mbc",
    "sbs",
    "ytn",
    "hani.co.kr",
    "khan.co.kr",
    "joongang",
    "chosun",
    "donga",
    "reuters",
    "apnews",
    "bbc",
    "hani.co.kr",
    "hani",
    "hani",
  ];

  const portal = ["naver", "daum", "msn"];

  if (major.some((v) => raw.includes(v))) {
    return { text: "주요 언론", className: "bg-green-100 text-green-700" };
  }

  if (portal.some((v) => raw.includes(v))) {
    return { text: "포털/재가공", className: "bg-yellow-100 text-yellow-700" };
  }

  return { text: "일반 출처", className: "bg-gray-100 text-gray-700" };
}

function formatDate(dateString: string) {
  try {
    return new Date(dateString).toLocaleString("ko-KR");
  } catch {
    return dateString;
  }
}

function truncate(text: string, max = 90) {
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function isLikelyUrl(text: string) {
  return /^https?:\/\//i.test(text.trim());
}

function buildShareCardText(result: AnalyzeResponse) {
  const facts = (result.facts || []).slice(0, 3).map((v) => `- ${v}`).join("\n");
  const cautions = (result.cautions || []).slice(0, 2).map((v) => `- ${v}`).join("\n");

  return [
    `이 글, 진짜인지 판단`,
    ``,
    `📊 신뢰도: ${result.trustScore}%`,
    `🧠 한줄 판단`,
    `${result.summary || "-"}`,
    ``,
    `📝 핵심 요약`,
    `${result.coreSummary || result.shareSummary || "-"}`,
    ``,
    `📌 확인된 내용`,
    facts || "- 확인된 내용 부족",
    ``,
    `⚠ 주의`,
    cautions || "- 특별한 주의 포인트 없음",
  ].join("\n");
}

async function downloadCardAsImage(result: AnalyzeResponse) {
  const lines = [
    "이 글, 진짜인지 판단",
    "",
    `신뢰도 ${result.trustScore}% · ${result.decision || "-"}`,
    "",
    "한줄 판단",
    result.summary || "-",
    "",
    "핵심 요약",
    result.coreSummary || result.shareSummary || "-",
    "",
    "확인된 내용",
    ...((result.facts || []).slice(0, 3).map((v) => `• ${v}`) || ["• 없음"]),
    "",
    "주의",
    ...((result.cautions || []).slice(0, 2).map((v) => `• ${v}`) || ["• 없음"]),
  ];

  const escaped = (value: string) =>
    value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

  const textEls = lines
    .map((line, idx) => {
      const y = 52 + idx * 28;
      const fontWeight =
        line === "이 글, 진짜인지 판단" ||
        line === "한줄 판단" ||
        line === "핵심 요약" ||
        line === "확인된 내용" ||
        line === "주의"
          ? 700
          : 400;

      const fontSize = line === "이 글, 진짜인지 판단" ? 24 : 16;

      return `<text x="32" y="${y}" font-size="${fontSize}" font-family="Arial, Apple SD Gothic Neo, sans-serif" font-weight="${fontWeight}" fill="#111827">${escaped(line)}</text>`;
    })
    .join("");

  const svg = `
  <svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350">
    <rect width="100%" height="100%" fill="#f3f4f6"/>
    <rect x="24" y="24" rx="32" ry="32" width="1032" height="1302" fill="#ffffff"/>
    ${textEls}
  </svg>`;

  const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  const img = new Image();
  img.src = url;

  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = reject;
  });

  const canvas = document.createElement("canvas");
  canvas.width = 1080;
  canvas.height = 1350;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  ctx.fillStyle = "#f3f4f6";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0);

  URL.revokeObjectURL(url);

  const pngUrl = canvas.toDataURL("image/png");
  const link = document.createElement("a");
  link.href = pngUrl;
  link.download = "news-check-result.png";
  link.click();
}

export default function HomePage() {
  const [input, setInput] = useState("");
  const [result, setResult] = useState<AnalyzeResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState<HistoryItem[]>([]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(HISTORY_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as HistoryItem[];
        setHistory(parsed);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    if (!result || result.error) return;

    const item: HistoryItem = {
      id: crypto.randomUUID(),
      input,
      createdAt: new Date().toISOString(),
      result,
    };

    setHistory((prev) => {
      const next = [
        item,
        ...prev.filter(
          (v) =>
            !(
              v.input === item.input &&
              v.result.summary === item.result.summary &&
              v.result.trustScore === item.result.trustScore
            )
        ),
      ].slice(0, 10);

      localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
      return next;
    });
  }, [result, input]);

  const keywords = useMemo(() => {
    if (!result) return [];
    const sourceText = [
      result.meta?.extractedTitle,
      result.coreSummary,
      result.shareSummary,
      ...(result.facts || []),
    ]
      .filter(Boolean)
      .join(" ");

    return extractKeywords(sourceText);
  }, [result]);

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
        throw new Error(`서버가 올바른 JSON 응답을 주지 않았습니다. (${res.status})`);
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

  const loadHistoryItem = (item: HistoryItem) => {
    setInput(item.input);
    setResult(item.result);
  };

  const clearHistory = () => {
    localStorage.removeItem(HISTORY_KEY);
    setHistory([]);
  };

  return (
    <main className="min-h-screen bg-gray-50 px-4 py-8 text-gray-900 sm:py-10">
      <div className="mx-auto max-w-4xl">
        <header className="mb-8 text-center">
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">이 글, 진짜인지 판단</h1>
          <p className="mt-4 text-sm leading-7 text-gray-600 sm:text-base">
            뉴스 링크, 기사 본문, 커뮤니티 글, SNS 글을 입력하면
            <br />
            웹 기사 비교를 포함해 사실 가능성과 핵심 내용을 정리합니다.
          </p>
        </header>

        <section className="rounded-3xl border border-gray-200 bg-white p-4 shadow-sm sm:p-5">
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
              연예인 루머
            </button>

            <button
              type="button"
              onClick={() =>
                setInput("정치인 발언 캡처가 사실인지 확인하고 싶다. 기사 근거가 있는지 봐줘.")
              }
              className="rounded-full border border-gray-300 px-3 py-1 text-xs text-gray-600 hover:bg-gray-50"
            >
              정치 발언
            </button>

            <button
              type="button"
              onClick={() =>
                setInput("이 건강 정보가 진짜인지 확인해줘. 커뮤니티에서 떠돌고 있다.")
              }
              className="rounded-full border border-gray-300 px-3 py-1 text-xs text-gray-600 hover:bg-gray-50"
            >
              건강 정보
            </button>

            <button
              type="button"
              onClick={() =>
                setInput("이 투자/부동산 찌라시가 사실인지 근거 기사랑 같이 확인해줘.")
              }
              className="rounded-full border border-gray-300 px-3 py-1 text-xs text-gray-600 hover:bg-gray-50"
            >
              투자 찌라시
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

          {input.trim() && (
            <div className="mt-3">
              <span
                className={`rounded-full px-3 py-1 text-xs font-medium ${
                  isLikelyUrl(input)
                    ? "bg-blue-100 text-blue-700"
                    : "bg-gray-100 text-gray-700"
                }`}
              >
                {isLikelyUrl(input) ? "링크 감지됨 · 본문 추출 시도" : "텍스트 직접 분석"}
              </span>
            </div>
          )}

          <div className="mt-5 flex flex-wrap justify-end gap-2">
            {result && !result.error && (
              <button
                type="button"
                onClick={handleAnalyze}
                disabled={loading}
                className="rounded-2xl border border-gray-300 px-4 py-3 text-sm font-semibold text-gray-700 transition hover:bg-gray-50 disabled:opacity-50"
              >
                다시 분석
              </button>
            )}

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

        {history.length > 0 && (
          <section className="mt-4 rounded-3xl border border-gray-200 bg-white p-4 shadow-sm sm:p-5">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-base font-semibold">최근 검사 히스토리</h2>
              <button
                type="button"
                onClick={clearHistory}
                className="text-xs text-gray-500 hover:text-gray-700"
              >
                전체 삭제
              </button>
            </div>

            <div className="mt-4 space-y-2">
              {history.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => loadHistoryItem(item)}
                  className="block w-full rounded-2xl border border-gray-200 bg-gray-50 p-3 text-left hover:bg-white"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-medium text-gray-900">
                      {truncate(item.result.coreSummary || item.input, 70)}
                    </p>
                    <span
                      className={`rounded-full px-2 py-1 text-xs font-medium ${getDecisionBadge(
                        item.result.decision
                      )}`}
                    >
                      {item.result.decision || "-"}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-gray-500">{formatDate(item.createdAt)}</p>
                </button>
              ))}
            </div>
          </section>
        )}

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
            {result.detail ? (
              <p className="mt-1 text-xs text-red-500">{result.detail}</p>
            ) : null}
          </section>
        )}

        {result && !result.error && (
          <div className="mt-6 space-y-4">
            <section className="rounded-3xl border border-gray-200 bg-white p-4 shadow-sm sm:p-5">
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
                <div className={`rounded-2xl border p-4 ${getTrustBg(result.trustScore)}`}>
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
                  <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/70">
                    <div
                      className={`h-full rounded-full ${getTrustBarColor(result.trustScore)}`}
                      style={{ width: `${Math.max(0, Math.min(100, result.trustScore))}%` }}
                    />
                  </div>
                </div>

                <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
                  <p className="text-sm text-gray-500">과장·낚시성 점수</p>
                  <div className="mt-2 flex items-end gap-2">
                    <p className={`text-4xl font-bold ${getClickbaitColor(result.clickbaitScore)}`}>
                      {result.clickbaitScore}
                    </p>
                    <span className="pb-1 text-lg text-gray-400">점</span>
                  </div>
                  <p className="mt-1 text-sm text-gray-600">
                    위험도: {getClickbaitLabel(result.clickbaitScore)}
                  </p>
                  <div className="mt-4 h-2 overflow-hidden rounded-full bg-gray-200">
                    <div
                      className={`h-full rounded-full ${getClickbaitBarColor(result.clickbaitScore)}`}
                      style={{ width: `${Math.max(0, Math.min(100, result.clickbaitScore))}%` }}
                    />
                  </div>
                </div>
              </div>

              <div className="mt-5 rounded-2xl bg-black p-4 text-white">
                <p className="text-xs uppercase tracking-wider text-gray-400">한줄 판단</p>
                <p className="mt-2 text-base font-semibold leading-relaxed">
                  {result.summary || "분석 요약이 없습니다."}
                </p>
              </div>
            </section>

            <section className="rounded-3xl border border-gray-200 bg-white p-4 shadow-sm sm:p-5">
              <h3 className="text-base font-semibold">검증 근거</h3>

              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <div>
                  <p className="text-sm font-semibold text-gray-900">📌 확인된 내용</p>
                  <ul className="mt-3 space-y-2 text-sm text-gray-700">
                    {(result.facts || []).length > 0 ? (
                      result.facts!.slice(0, 3).map((item, index) => (
                        <li key={index} className="rounded-xl bg-gray-50 px-3 py-2">
                          - {item}
                        </li>
                      ))
                    ) : (
                      <li className="rounded-xl bg-gray-50 px-3 py-2">확인된 내용이 부족합니다.</li>
                    )}
                  </ul>
                </div>

                <div>
                  <p className="text-sm font-semibold text-gray-900">⚠ 주의 포인트</p>
                  <ul className="mt-3 space-y-2 text-sm text-gray-700">
                    {(result.cautions || []).length > 0 ? (
                      result.cautions!.slice(0, 2).map((item, index) => (
                        <li key={index} className="rounded-xl bg-yellow-50 px-3 py-2">
                          - {item}
                        </li>
                      ))
                    ) : (
                      <li className="rounded-xl bg-yellow-50 px-3 py-2">
                        특별한 주의 포인트가 없습니다.
                      </li>
                    )}
                  </ul>
                </div>
              </div>
            </section>

            {keywords.length > 0 && (
              <section className="rounded-3xl border border-gray-200 bg-white p-4 shadow-sm sm:p-5">
                <h3 className="text-base font-semibold">주요 키워드</h3>
                <div className="mt-4 flex flex-wrap gap-2">
                  {keywords.map((keyword) => (
                    <span
                      key={keyword}
                      className="rounded-full bg-gray-100 px-3 py-1 text-sm text-gray-700"
                    >
                      #{keyword}
                    </span>
                  ))}
                </div>
              </section>
            )}

            <section className="rounded-3xl border border-gray-200 bg-white p-4 shadow-sm sm:p-5">
              <h3 className="text-base font-semibold">글 핵심 요약</h3>
              <div className="mt-4 rounded-2xl border border-gray-200 bg-gray-50 p-4">
                <p className="text-sm leading-7 text-gray-800">
                  {result.coreSummary || "-"}
                </p>
              </div>
            </section>

            <section className="rounded-3xl border border-gray-200 bg-white p-4 shadow-sm sm:p-5">
              <h3 className="text-base font-semibold">공유용 요약</h3>
              <div className="mt-4 rounded-2xl border border-gray-200 bg-gray-50 p-4">
                <p className="text-sm leading-7 text-gray-800">
                  {result.shareSummary || "-"}
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => copyText(result.shareSummary)}
                    className="rounded-xl border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-white"
                  >
                    복사
                  </button>
                  <button
                    type="button"
                    onClick={() => copyText(buildShareCardText(result))}
                    className="rounded-xl border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-white"
                  >
                    카드형 복사
                  </button>
                  <button
                    type="button"
                    onClick={() => downloadCardAsImage(result)}
                    className="rounded-xl bg-black px-3 py-2 text-sm text-white"
                  >
                    결과 카드 저장
                  </button>
                </div>
              </div>
            </section>

            <section className="rounded-3xl border border-gray-200 bg-white p-4 shadow-sm sm:p-5">
              <h3 className="text-base font-semibold">웹 근거 기사</h3>
              <div className="mt-4 space-y-3">
                {(result.evidenceSources || []).length > 0 ? (
                  result.evidenceSources?.map((source, index) => {
                    const trust = getSourceTrustLabel(source.sourceUrl, source.sourceName);

                    return (
                      <a
                        key={index}
                        href={source.articleUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="block rounded-2xl border border-gray-200 bg-gray-50 p-4 hover:bg-white"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-sm font-semibold text-gray-900">{source.title}</p>
                          <span className={`rounded-full px-2 py-1 text-xs font-medium ${trust.className}`}>
                            {trust.text}
                          </span>
                        </div>

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
                    );
                  })
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