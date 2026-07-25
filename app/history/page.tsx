import { desc } from "drizzle-orm";
import Link from "next/link";
import { getDb } from "../../db";
import { orderHistory } from "../../db/schema";
import { groupByDay, summarize, type HistoryEntry } from "../history";

export const dynamic = "force-dynamic";

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

function decisionLabel(decision: HistoryEntry["decision"]) {
  if (decision === "accept") return "接單";
  if (decision === "reject") return "不接";
  return "確認資料";
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

export default async function HistoryPage() {
  let entries: HistoryEntry[] = [];
  let error: string | null = null;

  try {
    entries = await loadEntries();
  } catch (loadError) {
    error =
      loadError instanceof Error
        ? loadError.message
        : "讀取記錄失敗，請稍後再試。";
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
        <h1>所有裝置的分析記錄</h1>
        <p>不論從手機、電腦、哪個 IP 上傳，分析完都會集中記在這裡。</p>
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
              <span>累計已分析</span>
              <strong>{overall.count} 筆</strong>
            </div>
            <div>
              <span>建議接單</span>
              <strong>{overall.acceptedCount} 筆</strong>
            </div>
            <div>
              <span>接單預估收入</span>
              <strong>${overall.acceptedIncome}</strong>
            </div>
          </div>

          {days.map((group) => (
            <section key={group.day} className="history-day">
              <div className="history-day-header">
                <h2>{group.day}</h2>
                <span>
                  {group.count} 筆・接單 {group.acceptedCount} 筆・預估收入 $
                  {group.acceptedIncome}
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
