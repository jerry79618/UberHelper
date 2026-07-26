export type Decision = "accept" | "reject" | "review";

export type HistoryEntry = {
  id: string;
  recordedAt: string;
  income: number;
  distance: number;
  minutes: number | null;
  stores: number;
  destination: string;
  decision: Decision;
  score: number | null;
  source: string | null;
};

const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000;

/**
 * 這個 App 只服務台北外送，記錄的「一天」固定用台北時區的日曆日切分，
 * 不管伺服器實際跑在哪個時區（Render 的機器多半是 UTC）。用 UTC getter
 * 搭配手動位移，才不會受執行環境的系統時區影響。
 */
export function taipeiDayKey(recordedAt: string): string {
  const shifted = new Date(new Date(recordedAt).getTime() + TAIPEI_OFFSET_MS);
  const year = shifted.getUTCFullYear();
  const month = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const day = String(shifted.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function average(values: number[]) {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/**
 * 這裡統計的是「收到的單品質如何」，不是實際收入。
 *
 * 上傳截圖只代表看過這張單，不代表真的接了，所以刻意不做任何金額加總——
 * 加總會讀起來像已經賺到的錢，那是誤導。改成看好單比例與平均效率。
 */
export function summarize(entries: HistoryEntry[]) {
  const worthTaking = entries.filter((entry) => entry.decision === "accept");
  // 缺金額或距離的記錄（判為「確認資料」的那些）算不出效率，排除掉再平均，
  // 不然會被 0 拉低。
  const hourly = entries
    .filter((entry) => entry.income > 0 && (entry.minutes ?? 0) > 0)
    .map((entry) => (entry.income / (entry.minutes as number)) * 60);
  const perKm = entries
    .filter((entry) => entry.income > 0 && entry.distance > 0)
    .map((entry) => entry.income / entry.distance);

  return {
    count: entries.length,
    worthTakingCount: worthTaking.length,
    worthTakingRatio: entries.length ? worthTaking.length / entries.length : 0,
    averageHourly: average(hourly),
    averagePerKm: average(perKm),
  };
}

export type DayGroup = ReturnType<typeof summarize> & {
  day: string;
  entries: HistoryEntry[];
};

/** 依台北日曆日分組，最新的一天排最前面；同一天內維持原本傳入的順序。 */
export function groupByDay(entries: HistoryEntry[]): DayGroup[] {
  const byDay = new Map<string, HistoryEntry[]>();

  for (const entry of entries) {
    const key = taipeiDayKey(entry.recordedAt);
    const bucket = byDay.get(key);
    if (bucket) bucket.push(entry);
    else byDay.set(key, [entry]);
  }

  return [...byDay.entries()]
    .sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
    .map(([day, dayEntries]) => ({
      day,
      entries: dayEntries,
      ...summarize(dayEntries),
    }));
}
