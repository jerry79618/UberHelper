import { getDb } from "../../../db";
import { orderHistory } from "../../../db/schema";
import type { Decision } from "../../history";

const DECISIONS: Decision[] = ["accept", "reject", "review"];

/**
 * Drizzle 只把 SQL 放在 message 裡，真正的原因藏在 cause 鏈上，
 * 只讀 message 會得到一長串 SQL 卻看不出為什麼失敗。
 */
function toRouteErrorMessage(error: unknown) {
  if (!(error instanceof Error)) return "Unexpected error";

  const causes: string[] = [];
  let current: unknown = error.cause;
  while (current instanceof Error && causes.length < 3) {
    causes.push(current.message);
    current = current.cause;
  }
  const detail = causes.join(" ← ");
  const combined = `${error.message} ${detail}`;

  if (/relation .* does not exist/.test(combined)) {
    return "order_history 資料表還沒建立。migration 會在伺服器啟動時自動套用，請重新部署一次，或檢查啟動 log 裡 [migrate] 開頭的訊息。";
  }

  return detail ? `${error.message}（原因：${detail}）` : error.message;
}

/** Cloudflare 用 cf-connecting-ip；一般反向代理常見 x-forwarded-for。 */
function clientSource(request: Request) {
  return (
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    null
  );
}

type HistoryPayload = {
  income?: number;
  distance?: number;
  minutes?: number | null;
  stores?: number;
  destination?: string;
  decision?: string;
  score?: number | null;
};

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as HistoryPayload;

    if (!DECISIONS.includes(payload.decision as Decision)) {
      return Response.json({ error: "decision 欄位不正確" }, { status: 400 });
    }

    const db = getDb();
    const [entry] = await db
      .insert(orderHistory)
      .values({
        id: crypto.randomUUID(),
        income: Number(payload.income) || 0,
        distance: Number(payload.distance) || 0,
        minutes: payload.minutes != null ? Number(payload.minutes) : null,
        stores: Number(payload.stores) || 1,
        destination: payload.destination ?? "",
        decision: payload.decision as Decision,
        score: payload.score != null ? Number(payload.score) : null,
        source: clientSource(request),
      })
      .returning();

    return Response.json({ entry }, { status: 201 });
  } catch (error) {
    return Response.json(
      { error: toRouteErrorMessage(error) },
      { status: 500 },
    );
  }
}

/**
 * 清空所有記錄。
 *
 * 注意：這個端點沒有任何身分驗證，知道網址的人都能清掉資料。這個網站本身
 * 就是公開的個人工具、記錄也只是測試用的統計，所以先維持簡單；如果之後
 * 需要保護，最省事的做法是加一個環境變數當密鑰再比對。
 */
export async function DELETE() {
  try {
    const db = getDb();
    const deleted = await db.delete(orderHistory).returning({
      id: orderHistory.id,
    });

    return Response.json({ deleted: deleted.length });
  } catch (error) {
    return Response.json(
      { error: toRouteErrorMessage(error) },
      { status: 500 },
    );
  }
}
