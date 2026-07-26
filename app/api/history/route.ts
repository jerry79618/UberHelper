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
    return "order_history 資料表還沒建立。請在 Render 的 Shell 執行 `npm run db:migrate` 套用 migration。";
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
