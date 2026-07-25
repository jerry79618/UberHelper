"use client";

import { ChangeEvent, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { flattenLines, moneyRectangle } from "./ocr-region";
import {
  evaluate,
  initialFields,
  parseOrderText,
  type OrderFields,
} from "./order";

type Phase = "idle" | "reading" | "ready" | "error";

async function imageDimensions(file: File) {
  const objectUrl = URL.createObjectURL(file);

  try {
    return await new Promise<{ width: number; height: number }>(
      (resolve, reject) => {
        const image = new Image();
        image.onload = () =>
          resolve({
            width: image.naturalWidth,
            height: image.naturalHeight,
          });
        image.onerror = () => reject(new Error("無法讀取圖片尺寸"));
        image.src = objectUrl;
      },
    );
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export default function Home() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [fields, setFields] = useState<OrderFields>(initialFields);
  const [rawText, setRawText] = useState("");
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState("準備辨識");
  const [previewUrl, setPreviewUrl] = useState<string>();
  const [errorMessage, setErrorMessage] = useState("");
  const [copied, setCopied] = useState(false);
  const [rawOpen, setRawOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const decision = useMemo(() => evaluate(fields), [fields]);

  // 記錄集中存在伺服器（跨裝置共用），這裡只負責送出，失敗也不擋主流程；
  // 要看記錄請到 /history 頁面，那裡直接查資料庫。
  function recordHistoryEntry(parsedFields: OrderFields) {
    const outcome = evaluate(parsedFields);

    void fetch("/api/history", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        income: Number(parsedFields.income) || 0,
        distance: Number(parsedFields.distance) || 0,
        minutes: Number(parsedFields.minutes) || null,
        stores: Number(parsedFields.stores) || 1,
        destination: parsedFields.destination,
        decision: outcome.kind,
        score: outcome.score,
      }),
    }).catch(() => {});
  }

  async function copyRawText() {
    try {
      await navigator.clipboard.writeText(rawText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

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
      const { createWorker, OEM, PSM } = await import("tesseract.js");
      const worker = await createWorker(["eng", "chi_tra"], 1, {
        logger: (message) => {
          if (typeof message.progress === "number") {
            setProgress(Math.round(message.progress * 75));
          }
          if (message.status === "recognizing text") {
            setStatus("正在讀取訂單內容");
          } else if (message.status.includes("language")) {
            setStatus("準備繁體中文辨識");
          }
        },
      });

      const result = await worker.recognize(
        file,
        {},
        { text: true, blocks: true },
      );
      let moneyText = "";
      let parsedFields = parseOrderText(result.data.text);
      await worker.terminate();

      if (!parsedFields.income) {
        setStatus("重新確認訂單金額");
        setProgress(80);

        const dimensions = await imageDimensions(file);
        // 派單卡片的金額是淺色大字配深色背景，LSTM 引擎在這種畫面上常把「1」
        // 讀成「I」或整段漏讀；改用傳統（legacy）引擎重掃這一小塊區域穩定得多。
        // 傳統引擎不支援字元白名單（會讓輸出整個消失），所以不設白名單，靠
        // parseOrderText 自己從乾淨許多的輸出裡挑數字。
        const moneyWorker = await createWorker(["eng"], OEM.TESSERACT_ONLY, {
          logger: (message) => {
            if (typeof message.progress === "number") {
              setProgress(80 + Math.round(message.progress * 20));
            }
          },
        });
        await moneyWorker.setParameters({
          tessedit_pageseg_mode: PSM.SINGLE_LINE,
        });
        const moneyResult = await moneyWorker.recognize(file, {
          rectangle: moneyRectangle(
            flattenLines(result.data.blocks),
            dimensions.width,
            dimensions.height,
          ),
        });
        moneyText = moneyResult.data.text.trim();
        parsedFields = parseOrderText(result.data.text, moneyText);
        await moneyWorker.terminate();
      }

      const text = result.data.text.trim();
      if (!text) throw new Error("圖片中沒有辨識到文字");

      setRawText(moneyText ? `${moneyText}\n\n${text}` : text);
      // 有欄位沒讀到時直接把原始文字攤開，才看得出 OCR 到底讀成什麼。
      setRawOpen(!parsedFields.income || !parsedFields.distance);
      setFields(parsedFields);
      recordHistoryEntry(parsedFields);
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
                  <span>取餐店家數</span>
                  <div className="input-shell">
                    <input
                      inputMode="numeric"
                      value={fields.stores}
                      onChange={(event) =>
                        updateField("stores", event.target.value)
                      }
                      placeholder="1"
                      aria-label="取餐店家數"
                    />
                    <b>間</b>
                  </div>
                </label>

                <label className="field-wide">
                  <span>目的地</span>
                  <div className="input-shell">
                    <input
                      value={fields.destination}
                      onChange={(event) =>
                        updateField("destination", event.target.value)
                      }
                      placeholder="例如 信義區吳興街"
                      aria-label="目的地"
                    />
                  </div>
                </label>
              </div>

              <details
                open={rawOpen}
                onToggle={(event) => setRawOpen(event.currentTarget.open)}
              >
                <summary>查看 OCR 原始文字</summary>
                <div className="raw-actions">
                  <button
                    type="button"
                    className="text-button"
                    onClick={copyRawText}
                  >
                    {copied ? "已複製" : "複製原始文字"}
                  </button>
                </div>
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
        <Link className="text-button" href="/history">
          查看所有記錄
        </Link>
      </footer>
    </main>
  );
}
