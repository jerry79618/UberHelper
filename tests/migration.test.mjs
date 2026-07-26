import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { desc } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { orderHistory } from "../db/schema.ts";

/**
 * 用 PGlite（真正的 Postgres，編譯成 WASM 跑在本機）驗證 drizzle/ 裡的
 * migration SQL 真的能套用，而且套用出來的資料表跟程式碼的 schema 對得上。
 *
 * 這是在沒有遠端資料庫的環境下能做到的最真實驗證。仍然沒有涵蓋的部分：
 * `pg` 驅動本身、連線字串解析、以及 Render 受管 Postgres 的 SSL 設定——
 * 那些只能接上真的遠端資料庫才驗得到。
 */
async function freshDb() {
  const client = new PGlite();
  const db = drizzle(client);
  await migrate(db, { migrationsFolder: "./drizzle" });
  return { db, client };
}

test("drizzle/ 的 migration 能在真正的 Postgres 上套用", async () => {
  const { client } = await freshDb();

  const result = await client.query(
    `select column_name, data_type, is_nullable
     from information_schema.columns
     where table_name = 'order_history'
     order by ordinal_position`,
  );
  const columns = result.rows.map((row) => row.column_name);

  assert.deepEqual(columns, [
    "id",
    "recorded_at",
    "income",
    "distance",
    "minutes",
    "stores",
    "destination",
    "decision",
    "score",
    "source",
  ]);
  await client.close();
});

test("重複套用 migration 不會出錯（啟動時每次都會跑）", async () => {
  const { db, client } = await freshDb();

  // 伺服器每次啟動都會呼叫一次，必須是安全的。
  await migrate(db, { migrationsFolder: "./drizzle" });
  await migrate(db, { migrationsFolder: "./drizzle" });

  await client.close();
});

test("寫入與讀取記錄的完整往返", async () => {
  const { db, client } = await freshDb();

  await db.insert(orderHistory).values({
    id: "test-1",
    income: 249,
    distance: 7.4,
    minutes: 30,
    stores: 1,
    destination: "內湖區康寧路3段",
    decision: "accept",
    score: 84,
    source: "1.2.3.4",
  });
  await db.insert(orderHistory).values({
    id: "test-2",
    income: 45,
    distance: 1.9,
    minutes: null,
    stores: 1,
    destination: "信義區松山路",
    decision: "reject",
    score: 40,
    source: null,
  });

  const rows = await db
    .select()
    .from(orderHistory)
    .orderBy(desc(orderHistory.recordedAt));

  assert.equal(rows.length, 2);

  const first = rows.find((row) => row.id === "test-1");
  assert.equal(first.income, 249);
  assert.equal(first.distance, 7.4);
  assert.equal(first.destination, "內湖區康寧路3段");
  assert.equal(first.decision, "accept");
  assert.equal(first.score, 84);
  assert.ok(first.recordedAt instanceof Date, "recorded_at 應為 Date");

  // minutes 與 source 可以是 null，score 也是（金額離譜時判 review 就沒有分數）。
  const second = rows.find((row) => row.id === "test-2");
  assert.equal(second.minutes, null);
  assert.equal(second.source, null);

  await client.close();
});

test("recorded_at 有預設值，不用手動給也能寫入", async () => {
  const { db, client } = await freshDb();

  const before = Date.now();
  await db.insert(orderHistory).values({
    id: "test-default",
    income: 100,
    distance: 3,
    decision: "accept",
  });
  const [row] = await db.select().from(orderHistory);

  assert.ok(row.recordedAt instanceof Date);
  // 允許一點時鐘誤差，只確認真的被自動填上了。
  assert.ok(row.recordedAt.getTime() >= before - 5000);
  assert.equal(row.stores, 1, "stores 預設應為 1");
  assert.equal(row.destination, "", "destination 預設應為空字串");

  await client.close();
});

test("清空所有記錄（對應 DELETE /api/history）", async () => {
  const { db, client } = await freshDb();

  await db.insert(orderHistory).values([
    { id: "a", income: 100, distance: 3, decision: "accept" },
    { id: "b", income: 50, distance: 2, decision: "reject" },
  ]);
  assert.equal((await db.select().from(orderHistory)).length, 2);

  const deleted = await db
    .delete(orderHistory)
    .returning({ id: orderHistory.id });

  assert.equal(deleted.length, 2, "returning 應回報刪除筆數給 API 回應用");
  assert.equal((await db.select().from(orderHistory)).length, 0);

  // 清空後還要能繼續寫入（不能因為刪除破壞了什麼）。
  await db
    .insert(orderHistory)
    .values({ id: "c", income: 80, distance: 4, decision: "accept" });
  assert.equal((await db.select().from(orderHistory)).length, 1);

  await client.close();
});

test("清空空資料表不會出錯", async () => {
  const { db, client } = await freshDb();

  const deleted = await db
    .delete(orderHistory)
    .returning({ id: orderHistory.id });

  assert.equal(deleted.length, 0);
  await client.close();
});
