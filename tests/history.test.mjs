import assert from "node:assert/strict";
import test from "node:test";
import {
  appendHistoryEntry,
  getServerHistorySnapshot,
  loadHistory,
  recordEntry,
  saveHistory,
  subscribeToHistory,
  summarizeToday,
  todaysEntries,
} from "../app/history.ts";

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
    ...overrides,
  };
}

test("沒有 window（SSR/測試環境）時讀寫都安全地什麼都不做", () => {
  assert.deepEqual(loadHistory(), []);
  assert.doesNotThrow(() => saveHistory([entry()]));
});

test("新記錄加在最前面，且超過上限會被裁掉", () => {
  const base = Array.from({ length: 200 }, (_, i) => entry({ id: `old-${i}` }));
  const result = appendHistoryEntry(base, entry({ id: "new" }));

  assert.equal(result.length, 200);
  assert.equal(result[0].id, "new");
});

test("只挑出今天（本機時區）的記錄", () => {
  const now = new Date("2026-07-26T15:00:00");
  const entries = [
    entry({ id: "today-morning", recordedAt: "2026-07-26T01:00:00" }),
    entry({ id: "yesterday", recordedAt: "2026-07-25T23:59:00" }),
    entry({ id: "today-evening", recordedAt: "2026-07-26T23:00:00" }),
  ];

  const result = todaysEntries(entries, now);

  assert.deepEqual(
    result.map((e) => e.id),
    ["today-morning", "today-evening"],
  );
});

test("伺服器快照永遠是空陣列，確保 SSR 跟剛掛載時畫面一致", () => {
  assert.deepEqual(getServerHistorySnapshot(), []);
});

test("recordEntry 會通知訂閱者（給 useSyncExternalStore 用）", () => {
  let notified = 0;
  const unsubscribe = subscribeToHistory(() => {
    notified += 1;
  });

  recordEntry(entry({ id: "notify-test" }));
  unsubscribe();

  assert.equal(notified, 1);
});

test("今日摘要只加總已接單的金額，不接／確認資料不計入", () => {
  const now = new Date("2026-07-26T15:00:00");
  const entries = [
    entry({ id: "a", recordedAt: "2026-07-26T09:00:00", decision: "accept", income: 118 }),
    entry({ id: "b", recordedAt: "2026-07-26T10:00:00", decision: "reject", income: 60 }),
    entry({ id: "c", recordedAt: "2026-07-26T11:00:00", decision: "review", income: 0 }),
    entry({ id: "d", recordedAt: "2026-07-25T09:00:00", decision: "accept", income: 999 }),
  ];

  const summary = summarizeToday(entries, now);

  assert.equal(summary.count, 3);
  assert.equal(summary.acceptedCount, 1);
  assert.equal(summary.acceptedIncome, 118);
});
