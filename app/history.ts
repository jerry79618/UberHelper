export type HistoryEntry = {
  id: string;
  recordedAt: string;
  income: number;
  distance: number;
  minutes: number | null;
  stores: number;
  destination: string;
  decision: "accept" | "reject" | "review";
  score: number | null;
};

const STORAGE_KEY = "uberhelper.history.v1";
// 只存數字結果、不存圖片，單筆很小，但還是設個上限避免無限長大。
const MAX_ENTRIES = 200;

export function loadHistory(): HistoryEntry[] {
  if (typeof window === "undefined") return [];

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveHistory(entries: HistoryEntry[]) {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(entries.slice(0, MAX_ENTRIES)),
    );
  } catch {
    // 儲存空間滿了或被瀏覽器封鎖時，記錄功能就當沒發生，不影響主要分析流程。
  }
}

export function appendHistoryEntry(
  entries: HistoryEntry[],
  entry: HistoryEntry,
): HistoryEntry[] {
  return [entry, ...entries].slice(0, MAX_ENTRIES);
}

// localStorage 在 SSR 階段不存在，用 useSyncExternalStore 而不是
// useEffect+setState 讀取，才能讓 React 自己處理「伺服器渲染時是空的、
// 掛載後才補上真正資料」這件事，不會有 hydration 不一致的問題。
type Listener = () => void;
let listeners: Listener[] = [];
let cachedSnapshot: HistoryEntry[] | null = null;

function notify(next: HistoryEntry[]) {
  cachedSnapshot = next;
  for (const listener of listeners) listener();
}

export function subscribeToHistory(listener: Listener) {
  listeners.push(listener);
  return () => {
    listeners = listeners.filter((current) => current !== listener);
  };
}

export function getHistorySnapshot(): HistoryEntry[] {
  if (cachedSnapshot === null) cachedSnapshot = loadHistory();
  return cachedSnapshot;
}

export function getServerHistorySnapshot(): HistoryEntry[] {
  return [];
}

export function recordEntry(entry: HistoryEntry) {
  const next = appendHistoryEntry(loadHistory(), entry);
  saveHistory(next);
  notify(next);
}

export function clearEntries(keep: (entry: HistoryEntry) => boolean) {
  const next = loadHistory().filter(keep);
  saveHistory(next);
  notify(next);
}

function isSameLocalDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function todaysEntries(
  entries: HistoryEntry[],
  now = new Date(),
): HistoryEntry[] {
  return entries.filter((entry) =>
    isSameLocalDay(new Date(entry.recordedAt), now),
  );
}

export function summarizeToday(entries: HistoryEntry[], now = new Date()) {
  const today = todaysEntries(entries, now);
  const accepted = today.filter((entry) => entry.decision === "accept");

  return {
    count: today.length,
    acceptedCount: accepted.length,
    acceptedIncome: accepted.reduce((sum, entry) => sum + entry.income, 0),
  };
}
