import { desc } from "drizzle-orm";
import Link from "next/link";
import { getDb } from "../../db";
import { orderHistory } from "../../db/schema";
import { groupByDay, summarize, type HistoryEntry } from "../history";
import { ClearHistoryButton } from "./clear-button";

export const dynamic = "force-dynamic";

function formatMoney(value: number | null) {
  return value === null ? "—" : `$${Math.round(value)}`;
}

function toHistoryEntry(row: typeof orderHistory.$inferSelect): HistoryEntry {
  return {
    id: row.id,
    recordedAt: row.recordedAt.toISOString(),
    income: row.income,
    distance: row.distance,
    minutes: row.minutes,
    stores: row.stores,
    destination: row.destination,
    decision: row.decision as HistoryEntry["decision"],
    score: row.score,
    source: row.source,
  };
}

/**
 * 這裡是「當時系統給的建議」，不是使用者實際的行為，所以用「值得／不值得」
 * 而不是「接單／不接」——後者讀起來像已經接了。
 */
function decisionLabel(decision: HistoryEntry["decision"]) {
  if (decision === "accept") return "值得";
  if (decision === "reject") return "不值得";
  return "資料不全";
}

async function loadEntries() {
  const db = getDb();
  const rows = await db
    .select()
    .from(orderHistory)
    .orderBy(desc(orderHistory.recordedAt))
    .limit(500);

  return rows.map(toHistoryEntry);
}

/**
 * Drizzle 只把 SQL 放在 message 裡，真正的原因（例如「資料表不存在」）藏在
 * cause 的鏈上。只顯示 message 會得到一長串 SQL 卻看不出為什麼失敗。
 */
function describeDbError(error: unknown): string {
  if (!(error instanceof Error)) return "讀取記錄失敗，請稍後再試。";

  const causes: string[] = [];
  let current: unknown = error.cause;
  while (current instanceof Error && causes.length < 3) {
    causes.push(current.message);
    current = current.cause;
  }
  const detail = causes.join(" ← ");

  if (/relation .* does not exist|order_history/.test(detail)) {
    return `資料表 order_history 還不存在。請先套用 migration：在 Render 的 Shell 執行 npm run db:migrate（原始錯誤：${detail}）`;
  }

  return detail ? `${error.message}（原因：${detail}）` : error.message;
}

export default async function HistoryPage() {
  let entries: HistoryEntry[] = [];
  let error: string | null = null;

  try {
    entries = await loadEntries();
  } catch (loadError) {
    // 伺服器 log 留完整堆疊，畫面上只顯示收斂過的訊息。
    console.error("[history] 讀取記錄失敗:", loadError);
    error = describeDbError(loadError);
  }

  const days = groupByDay(entries);
  const overall = summarize(entries);

  return (
    <main className="history-page">
      <header className="history-page-header">
        <Link className="brand" href="/" aria-label="回到 UberHelper 首頁">
          <span className="brand-mark">UH</span>
          <span>UberHelper</span>
        </Link>
        <h1>收到的單品質記錄</h1>
        <p>
          不論從手機、電腦、哪個 IP 上傳都會集中記在這裡。這裡記的是「你收到
          什麼樣的單」，<strong>上傳不等於接了這張單</strong>，所以不會累計實際收入。
        </p>
      </header>

      {error && (
        <div className="history-page-error">
          <strong>目前讀不到記錄</strong>
          <p>{error}</p>
        </div>
      )}

      {!error && entries.length === 0 && (
        <p className="history-empty">還沒有任何記錄。</p>
      )}

      {!error && entries.length > 0 && (
        <>
          <div className="history-summary history-summary-page">
            <div>
              <span>收到的單</span>
              <strong>{overall.count} 筆</strong>
            </div>
            <div>
              <span>其中值得接</span>
              <strong>
                {overall.worthTakingCount} 筆
                <em>（{Math.round(overall.worthTakingRatio * 100)}%）</em>
              </strong>
            </div>
            <div>
              <span>平均時薪</span>
              <strong>{formatMoney(overall.averageHourly)}</strong>
            </div>
            <div>
              <span>平均每公里</span>
              <strong>{formatMoney(overall.averagePerKm)}</strong>
            </div>
          </div>

          <div className="history-actions">
            <ClearHistoryButton count={overall.count} />
          </div>

          {days.map((group) => (
            <section key={group.day} className="history-day">
              <div className="history-day-header">
                <h2>{group.day}</h2>
                <span>
                  {group.count} 筆・值得接 {group.worthTakingCount} 筆・平均時薪{" "}
                  {formatMoney(group.averageHourly)}
                </span>
              </div>

              <ul className="history-list">
                {group.entries.map((entry) => (
                  <li
                    key={entry.id}
                    className={`history-item history-${entry.decision}`}
                  >
                    <span className="history-time">
                      {new Date(entry.recordedAt).toLocaleTimeString(
                        "zh-TW",
                        {
                          hour: "2-digit",
                          minute: "2-digit",
                          timeZone: "Asia/Taipei",
                        },
                      )}
                    </span>
                    <span className="history-decision">
                      {decisionLabel(entry.decision)}
                    </span>
                    <span className="history-amount">
                      {entry.income ? `$${entry.income}` : "—"}
                    </span>
                    <span className="history-destination">
                      {entry.destination || "—"}
                    </span>
                    <span className="history-score">
                      {entry.score !== null ? `${entry.score} 分` : "—"}
                    </span>
                    <span className="history-source">
                      {entry.source ?? "—"}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </>
      )}
    </main>
  );
}
