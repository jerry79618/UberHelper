import assert from "node:assert/strict";
import test from "node:test";
import { groupByDay, summarize, taipeiDayKey } from "../app/history.ts";

function entry(overrides = {}) {
  return {
    id: "1",
    recordedAt: "2026-07-26T10:00:00.000Z",
    income: 118,
    distance: 5.8,
    minutes: 28,
    stores: 2,
    destination: "信義區吳興街",
    decision: "accept",
    score: 71,
    source: "1.2.3.4",
    ...overrides,
  };
}

test("台北日曆日的分界點是 UTC 16:00（隔天 00:00 台北時間），不是伺服器的系統時區", () => {
  // Render 的機器多半跑 UTC，這裡刻意選在 UTC 邊界附近驗證，不能只測「明顯是同一天」的案例。
  assert.equal(taipeiDayKey("2026-07-25T15:59:00.000Z"), "2026-07-25");
  assert.equal(taipeiDayKey("2026-07-25T16:00:00.000Z"), "2026-07-26");
  assert.equal(taipeiDayKey("2026-07-25T23:59:00.000Z"), "2026-07-26");
});

test("summarize 只加總已接單的金額，不接／確認資料不計入", () => {
  const entries = [
    entry({ decision: "accept", income: 118 }),
    entry({ decision: "reject", income: 60 }),
    entry({ decision: "review", income: 0 }),
  ];

  const summary = summarize(entries);

  assert.equal(summary.count, 3);
  assert.equal(summary.acceptedCount, 1);
  assert.equal(summary.acceptedIncome, 118);
});

test("groupByDay 依台北日曆日分組，最新的一天排最前面", () => {
  const entries = [
    entry({ id: "a", recordedAt: "2026-07-24T09:00:00.000Z" }), // 台北 07-24 17:00
    entry({ id: "b", recordedAt: "2026-07-26T01:00:00.000Z" }), // 台北 07-26 09:00
    entry({ id: "c", recordedAt: "2026-07-26T20:00:00.000Z" }), // 台北 07-27 04:00
  ];

  const days = groupByDay(entries);

  assert.deepEqual(
    days.map((group) => group.day),
    ["2026-07-27", "2026-07-26", "2026-07-24"],
  );
  assert.deepEqual(
    days[0].entries.map((e) => e.id),
    ["c"],
  );
  assert.deepEqual(
    days[1].entries.map((e) => e.id),
    ["b"],
  );
  assert.deepEqual(
    days[2].entries.map((e) => e.id),
    ["a"],
  );
});

test("groupByDay 同一天內維持原本傳入的順序，並附上該天的摘要", () => {
  const entries = [
    entry({ id: "first", recordedAt: "2026-07-26T01:00:00.000Z", decision: "accept", income: 100 }),
    entry({ id: "second", recordedAt: "2026-07-26T02:00:00.000Z", decision: "reject", income: 50 }),
  ];

  const [group] = groupByDay(entries);

  assert.deepEqual(
    group.entries.map((e) => e.id),
    ["first", "second"],
  );
  assert.equal(group.count, 2);
  assert.equal(group.acceptedCount, 1);
  assert.equal(group.acceptedIncome, 100);
});
