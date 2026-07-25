"use client";

import { ChangeEvent, useMemo, useRef, useState } from "react";

type Phase = "idle" | "reading" | "ready" | "error";

type OrderFields = {
  income: string;
  distance: string;
  minutes: string;
  destination: string;
};

type Decision = {
  kind: "accept" | "reject" | "review";
  score: number | null;
  hourlyIncome: number | null;
  incomePerKm: number | null;
  reasons: string[];
};

const hotAreas = [
  "信義",
  "永吉路",
  "ATT",
  "101",
  "微風信義",
  "市政府",
  "松高路",
  "松仁路",
  "大安",
  "松山",
];

const coldAreas = ["木柵", "文山", "山區", "偏遠住宅", "南港"];

const initialFields: OrderFields = {
  income: "",
  distance: "",
  minutes: "",
  destination: "",
};

function firstMatch(text: string, patterns: RegExp[]) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return match[1].replace(",", ".");
  }
  return "";
}

function findArea(text: string) {
  return [...hotAreas, ...coldAreas].find((area) =>
    text.toLocaleLowerCase().includes(area.toLocaleLowerCase()),
  );
}

function parseOrderText(text: string): OrderFields {
  const normalized = text
    .replaceAll("，", ",")
    .replaceAll("．", ".")
    .replaceAll("＄", "$");

  return {
    income: firstMatch(normalized, [
      /(?:NT\$|NTD|\$)\s*([0-9]{2,4}(?:[.,][0-9]+)?)/i,
      /(?:收入|費用|金額|預估收入)\s*[:：]?\s*([0-9]{2,4}(?:[.,][0-9]+)?)/i,
      /([0-9]{2,4}(?:[.,][0-9]+)?)\s*元/i,
    ]),
    distance: firstMatch(normalized, [
      /([0-9]+(?:[.,][0-9]+)?)\s*(?:公里|km)/i,
    ]),
    minutes: firstMatch(normalized, [
      /([0-9]{1,3}(?:[.,][0-9]+)?)\s*(?:分鐘|分|min|mins|minutes)/i,
    ]),
    destination:
      normalized.match(
        /(?:送達|目的地|終點)\s*[:：]?\s*([^\n\r]+)/i,
      )?.[1]?.trim() ??
      findArea(normalized) ??
      "",
  };
}

function clamp(value: number) {
  return Math.min(Math.max(value, 0), 100);
}

function normalize(value: number, low: number, high: number) {
  return clamp(((value - low) / (high - low)) * 100);
}

function includesArea(destination: string, areas: string[]) {
  return areas.some((area) =>
    destination.toLocaleLowerCase().includes(area.toLocaleLowerCase()),
  );
}

function evaluate(fields: OrderFields): Decision {
  const income = Number(fields.income);
  const distance = Number(fields.distance);

  if (!income || !distance || income <= 0 || distance <= 0) {
    const reasons = [];
    if (!income || income <= 0) reasons.push("請確認訂單金額");
    if (!distance || distance <= 0) reasons.push("請確認配送距離");
    return {
      kind: "review",
      score: null,
      hourlyIncome: null,
      incomePerKm: null,
      reasons,
    };
  }

  const minutes =
    Number(fields.minutes) > 0
      ? Number(fields.minutes)
      : 8 + distance * 4.5;
  const hourlyIncome = (income / minutes) * 60;
  const incomePerKm = income / distance;
  const isHot = includesArea(fields.destination, hotAreas);
  const isCold = includesArea(fields.destination, coldAreas);
  const destinationScore = isHot ? 90 : isCold ? 20 : 50;
  const returnScore = isHot ? 90 : isCold ? 15 : 50;

  const score =
    normalize(hourlyIncome, 160, 420) * 0.35 +
    normalize(incomePerKm, 12, 40) * 0.25 +
    destinationScore * 0.2 +
    60 * 0.1 +
    returnScore * 0.1;
  const kind = score >= 60 ? "accept" : "reject";
  const reasons: string[] = [];

  if (kind === "accept") {
    if (hourlyIncome >= 300) {
      reasons.push(`預估時薪 $${Math.round(hourlyIncome)}，效率良好`);
    } else {
      reasons.push("綜合收益與路線達到接單門檻");
    }
    if (incomePerKm >= 25) {
      reasons.push(`每公里 $${Math.round(incomePerKm)}，距離效益良好`);
    }
    if (isHot) {
      reasons.push(`終點在${fields.destination}，送達後較容易留在熱區`);
    }
  } else {
    if (hourlyIncome < 250) {
      reasons.push(`預估時薪僅 $${Math.round(hourlyIncome)}，可能拉低效率`);
    }
    if (incomePerKm < 20) {
      reasons.push(`每公里僅 $${Math.round(incomePerKm)}，距離成本偏高`);
    }
    if (isCold) {
      reasons.push(`終點在${fields.destination}，空車回熱區風險較高`);
    }
  }

  if (!reasons.length) {
    reasons.push(
      kind === "accept" ? "綜合評分達到接單門檻" : "綜合評分未達接單門檻",
    );
  }

  return {
    kind,
    score: Math.round(score),
    hourlyIncome,
    incomePerKm,
    reasons: reasons.slice(0, 3),
  };
}

export default function Home() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [fields, setFields] = useState<OrderFields>(initialFields);
  const [rawText, setRawText] = useState("");
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState("準備辨識");
  const [previewUrl, setPreviewUrl] = useState<string>();
  const [errorMessage, setErrorMessage] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const decision = useMemo(() => evaluate(fields), [fields]);

  async function analyzeImage(file: File) {
    if (!file.type.startsWith("image/")) {
      setErrorMessage("請選擇圖片格式的訂單截圖。");
      setPhase("error");
      return;
    }

    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(URL.createObjectURL(file));
    setPhase("reading");
    setProgress(0);
    setStatus("載入文字辨識工具");
    setErrorMessage("");

    try {
      const { createWorker } = await import("tesseract.js");
      const worker = await createWorker(["eng", "chi_tra"], 1, {
        logger: (message) => {
          if (typeof message.progress === "number") {
            setProgress(Math.round(message.progress * 100));
          }
          if (message.status === "recognizing text") {
            setStatus("正在讀取訂單內容");
          } else if (message.status.includes("language")) {
            setStatus("準備繁體中文辨識");
          }
        },
      });

      const result = await worker.recognize(file);
      await worker.terminate();

      const text = result.data.text.trim();
      if (!text) throw new Error("圖片中沒有辨識到文字");

      setRawText(text);
      setFields(parseOrderText(text));
      setProgress(100);
      setPhase("ready");
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "無法辨識這張圖片，請換一張較清晰的截圖。",
      );
      setPhase("error");
    }
  }

  function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) void analyzeImage(file);
    event.target.value = "";
  }

  function updateField(field: keyof OrderFields, value: string) {
    setFields((current) => ({ ...current, [field]: value }));
  }

  function reset() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(undefined);
    setFields(initialFields);
    setRawText("");
    setProgress(0);
    setErrorMessage("");
    setPhase("idle");
  }

  return (
    <main className="site-shell">
      <header className="topbar">
        <a className="brand" href="#" aria-label="UberHelper 首頁">
          <span className="brand-mark">UH</span>
          <span>UberHelper</span>
        </a>
        <span className="local-badge">
          <span className="status-dot" />
          圖片留在裝置
        </span>
      </header>

      <section className="hero">
        <div className="eyebrow">
          <span>DELIVERY DECISION COPILOT</span>
          <span className="eyebrow-line" />
        </div>
        <h1>
          截圖，
          <br />
          <em>立刻決定。</em>
        </h1>
        <p>
          上傳外送訂單截圖，系統會在瀏覽器辨識金額、距離和目的地，直接告訴你值不值得接。
        </p>
      </section>

      <section className="workspace" aria-live="polite">
        {phase === "idle" && (
          <button
            className="upload-card"
            type="button"
            onClick={() => inputRef.current?.click()}
          >
            <span className="upload-icon" aria-hidden="true">
              <span className="corner corner-a" />
              <span className="corner corner-b" />
              <span className="corner corner-c" />
              <span className="corner corner-d" />
              <span className="camera-dot" />
            </span>
            <span className="upload-title">選擇訂單截圖</span>
            <span className="upload-copy">
              從相簿選擇剛才的截圖，或直接拍攝畫面
            </span>
            <span className="upload-cta">開始分析</span>
            <span className="format-note">JPG、PNG、HEIC</span>
          </button>
        )}

        {phase === "reading" && (
          <div className="processing-card">
            <div className="scan-preview">
              {previewUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={previewUrl} alt="正在辨識的訂單截圖" />
              )}
              <span className="scan-line" />
            </div>
            <div className="processing-copy">
              <span className="step-label">OCR ANALYSIS</span>
              <h2>{status}</h2>
              <p>第一次使用需要下載辨識模型，之後會更快。</p>
              <div
                className="progress-track"
                role="progressbar"
                aria-valuenow={progress}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <span style={{ width: `${Math.max(progress, 5)}%` }} />
              </div>
              <strong>{progress}%</strong>
            </div>
          </div>
        )}

        {phase === "error" && (
          <div className="error-card">
            <span className="error-symbol">!</span>
            <h2>這張圖片暫時讀不到</h2>
            <p>{errorMessage}</p>
            <button type="button" onClick={() => inputRef.current?.click()}>
              重新選擇截圖
            </button>
          </div>
        )}

        {phase === "ready" && (
          <div className="result-layout">
            <section
              className={`decision-card decision-${decision.kind}`}
              aria-label="接單判斷"
            >
              <div className="decision-top">
                <span className="decision-kicker">AI DECISION</span>
                {decision.score !== null && (
                  <span className="score">{decision.score} 分</span>
                )}
              </div>

              <div className="decision-main">
                <span className="decision-symbol">
                  {decision.kind === "accept"
                    ? "✓"
                    : decision.kind === "reject"
                      ? "×"
                      : "!"}
                </span>
                <div>
                  <span>建議</span>
                  <h2>
                    {decision.kind === "accept"
                      ? "接單"
                      : decision.kind === "reject"
                        ? "不接"
                        : "確認資料"}
                  </h2>
                </div>
              </div>

              <div className="metrics">
                <div>
                  <span>預估時薪</span>
                  <strong>
                    {decision.hourlyIncome
                      ? `$${Math.round(decision.hourlyIncome)}`
                      : "—"}
                  </strong>
                </div>
                <div>
                  <span>每公里</span>
                  <strong>
                    {decision.incomePerKm
                      ? `$${Math.round(decision.incomePerKm)}`
                      : "—"}
                  </strong>
                </div>
              </div>

              <div className="reason-list">
                <span className="reason-heading">判斷原因</span>
                {decision.reasons.map((reason) => (
                  <p key={reason}>
                    <span>•</span>
                    {reason}
                  </p>
                ))}
              </div>
            </section>

            <section className="fields-card">
              <div className="fields-header">
                <div>
                  <span className="step-label">辨識結果</span>
                  <h2>請快速確認</h2>
                </div>
                <button type="button" className="text-button" onClick={reset}>
                  換一張
                </button>
              </div>

              <div className="field-grid">
                <label>
                  <span>訂單金額</span>
                  <div className="input-shell">
                    <b>$</b>
                    <input
                      inputMode="decimal"
                      value={fields.income}
                      onChange={(event) =>
                        updateField("income", event.target.value)
                      }
                      placeholder="例如 95"
                      aria-label="訂單金額"
                    />
                  </div>
                </label>

                <label>
                  <span>配送距離</span>
                  <div className="input-shell">
                    <input
                      inputMode="decimal"
                      value={fields.distance}
                      onChange={(event) =>
                        updateField("distance", event.target.value)
                      }
                      placeholder="例如 3.2"
                      aria-label="配送距離"
                    />
                    <b>km</b>
                  </div>
                </label>

                <label>
                  <span>預估時間</span>
                  <div className="input-shell">
                    <input
                      inputMode="numeric"
                      value={fields.minutes}
                      onChange={(event) =>
                        updateField("minutes", event.target.value)
                      }
                      placeholder="自動估算"
                      aria-label="預估時間"
                    />
                    <b>分</b>
                  </div>
                </label>

                <label>
                  <span>目的地</span>
                  <div className="input-shell">
                    <input
                      value={fields.destination}
                      onChange={(event) =>
                        updateField("destination", event.target.value)
                      }
                      placeholder="例如 市政府"
                      aria-label="目的地"
                    />
                  </div>
                </label>
              </div>

              <details>
                <summary>查看 OCR 原始文字</summary>
                <pre>{rawText}</pre>
              </details>
            </section>
          </div>
        )}

        <input
          ref={inputRef}
          className="file-input"
          type="file"
          accept="image/*"
          onChange={onFileChange}
        />
      </section>

      <section className="how-it-works">
        <span className="section-number">01—03</span>
        <div className="steps">
          <article>
            <b>01</b>
            <h3>截下訂單</h3>
            <p>在外送平台出現新單時先截圖。</p>
          </article>
          <article>
            <b>02</b>
            <h3>上傳分析</h3>
            <p>圖片只在你的瀏覽器處理，不會儲存。</p>
          </article>
          <article>
            <b>03</b>
            <h3>立即決定</h3>
            <p>根據時薪、距離和終點取得明確建議。</p>
          </article>
        </div>
      </section>

      <footer>
        <span>UberHelper</span>
        <p>輔助判斷，不會自動操作外送平台。行車安全優先。</p>
      </footer>
    </main>
  );
}

