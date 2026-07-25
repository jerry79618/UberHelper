export type OrderFields = {
  income: string;
  distance: string;
  minutes: string;
  stores: string;
  destination: string;
};

export type Decision = {
  kind: "accept" | "reject" | "review";
  score: number | null;
  hourlyIncome: number | null;
  incomePerKm: number | null;
  reasons: string[];
};

export const hotAreas = [
  "信義",
  "永吉路",
  "ATT",
  "101",
  "微風信義",
  "市政府",
  "松高路",
  "松仁路",
  "吳興街",
  "基隆路二段",
  "忠孝東路",
  "光復南路",
  "大安",
  "松山",
];

export const coldAreas = ["木柵", "文山", "山區", "偏遠住宅", "南港", "汐止"];

export const initialFields: OrderFields = {
  income: "",
  distance: "",
  minutes: "",
  stores: "",
  destination: "",
};

/** MVP 假設值，需要用真實訂單持續校正。 */
export const scoring = {
  acceptScore: 60,
  hourly: { low: 150, high: 350, weight: 0.35 },
  perKm: { low: 10, high: 32, weight: 0.25 },
  destination: { hot: 90, unknown: 55, cold: 25, weight: 0.2 },
  waiting: { single: 70, double: 55, many: 40, weight: 0.1 },
  returning: { hot: 90, unknown: 55, cold: 20, weight: 0.1 },
};

const CHINESE = "\\u4e00-\\u9fa5";
const districtPattern = new RegExp(`([${CHINESE}]{2,3}區)`);
const roadPattern = new RegExp(
  `([${CHINESE}]{1,6}(?:路|街|大道)(?:[一二三四五六七八九十]段)?)`,
);
const villagePattern = new RegExp(`[${CHINESE}]{1,3}里`, "g");

function normalizeText(text: string) {
  return text
    .replaceAll("，", ",")
    .replaceAll("．", ".")
    .replaceAll("＄", "$")
    .replaceAll("（", "(")
    .replaceAll("）", ")")
    .replaceAll("：", ":")
    .replaceAll("臺", "台");
}

function firstMatch(text: string, patterns: RegExp[]) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return match[1];
  }
  return "";
}

/** 把 OCR 常見的字母誤判還原成數字；全是字母（例如 SOS）則視為誤判並放棄。 */
function digitize(token: string) {
  if (!token) return "";
  const confusions: Record<string, string> = {
    O: "0",
    o: "0",
    I: "1",
    l: "1",
    i: "1",
    S: "5",
    s: "5",
    B: "8",
    b: "8",
    Z: "2",
    z: "2",
  };
  const digits = token.replace(/[OoIliSsBbZz]/g, (char) => confusions[char]);

  return /[0-9]/.test(token) && /^[0-9]{2,4}$/.test(digits) ? digits : "";
}

function isAddressLine(line: string) {
  return districtPattern.test(line) && /號|巷|弄|路|街|大道/.test(line);
}

/**
 * 地址常常在卡片上換行斷開（「…信義區四維里松山」／「路242號」），行政區和路名
 * 分屬不同行，單行比對會全部落空。往回最多合併三行再判斷，並且優先採用最靠近
 * 畫面下方（最後一個停靠點）的組合。
 */
function findAddressBlock(lines: string[]) {
  for (let end = lines.length; end >= 1; end -= 1) {
    for (let span = 1; span <= 3 && span <= end; span += 1) {
      const candidate = lines.slice(end - span, end).join("");
      if (isAddressLine(candidate)) return candidate;
    }
  }
  return "";
}

/** 把「110台灣台北市信義區惠安里吳興街432巷150號」收斂成「信義區吳興街」。 */
function tidyAddress(raw: string) {
  const cleaned = raw
    .replace(/^[0-9\s]+/, "")
    .replace(/台灣|台北市|新北市|桃園市|台中市|台南市|高雄市/g, "")
    .trim();
  const district = cleaned.match(districtPattern)?.[1] ?? "";
  // 先切掉行政區再清里名，否則「信義區惠安里」會被當成一個里名整段吃掉。
  const rest = (
    district
      ? cleaned.slice(cleaned.indexOf(district) + district.length)
      : cleaned
  ).replace(villagePattern, "");
  const road = rest.match(roadPattern)?.[1] ?? "";

  return `${district}${road}` || cleaned.slice(0, 12) || raw.trim();
}

/**
 * 派單畫面沒有「目的地」標籤，只有一串停靠點，最後一筆地址才是終點。
 * 先抓地址，抓不到才退回關鍵字，而且從畫面下方往上找，避免抓到地圖上的路名標籤。
 */
function parseDestination(lines: string[]) {
  const labelled = lines
    .map((line) => line.match(/(?:送達|目的地|終點)\s*:?\s*(.+)/)?.[1]?.trim())
    .filter((value): value is string => Boolean(value));
  if (labelled.length) return tidyAddress(labelled[labelled.length - 1]);

  const addressBlock = findAddressBlock(lines);
  if (addressBlock) return tidyAddress(addressBlock);

  const areas = [...hotAreas, ...coldAreas];
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const hit = areas.find((area) =>
      lines[index].toLocaleLowerCase().includes(area.toLocaleLowerCase()),
    );
    if (hit) return hit;
  }

  return "";
}

export function parseOrderText(text: string, moneyRegionText = ""): OrderFields {
  const normalized = normalizeText(text);
  // LSTM 對中文常常一字一字辨識，字與字之間會插入空白（"信義 區 吳 興 街"），
  // 地址和標籤比對都需要去掉這些空白才比對得上；中文地址本來就不含有意義的空白。
  const lines = normalized
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, ""))
    .filter(Boolean);
  // 只清行內空白、保留換行：金額獨佔一行，把換行清掉會讓下一行開頭的字元
  // （例如被 OCR 讀成數字的時鐘圖示）黏在金額後面，NT$45 就變成 454。
  const compact = normalized.replace(/[^\S\r\n]+/g, "");
  // 狀態列時鐘與抵達時間會污染「分鐘」與金額的比對。
  const compactNoClock = compact.replace(/[0-9]{1,2}:[0-9]{2}/g, " ");
  const compactMoneyRegion = normalizeText(moneyRegionText)
    .replace(/[^\S\r\n]+/g, "")
    .replace(/[0-9]{1,2}:[0-9]{2}/g, " ");

  const incomePatterns = [
    // 派單卡片的金額獨佔一行，整行吻合的優先。
    /^NT[$S5]?([0-9]{2,4}(?:\.[0-9]{1,2})?)$/im,
    /^[$]([0-9]{2,4}(?:\.[0-9]{1,2})?)$/m,
    /NT[$S5]?([0-9]{2,4}(?:\.[0-9]{1,2})?)/i,
    /[$]([0-9]{2,4}(?:\.[0-9]{1,2})?)/,
    /(?:預估收入|收入|費用|金額|車資)[:]?([0-9]{2,4}(?:\.[0-9]{1,2})?)/,
    /([0-9]{2,4}(?:\.[0-9]{1,2})?)元/,
  ];
  // 金額是卡片上最大的字，反而常被讀成字母（NT$118 → NTSI18、NT$1l8）。
  // 只有在確定是金額那一行時才做字元還原，避免把內文的字母也當成數字。
  const confusedIncomePatterns = [
    /^NT[$S5]?([0-9OoIliSsBbZz]{2,4})$/im,
    /^[$]([0-9OoIliSsBbZz]{2,4})$/m,
    /NT[$S5]([0-9OoIliSsBbZz]{2,4})/i,
  ];
  const income =
    firstMatch(compactNoClock, incomePatterns) ||
    digitize(firstMatch(compactNoClock, confusedIncomePatterns)) ||
    firstMatch(compactMoneyRegion, incomePatterns) ||
    digitize(
      firstMatch(compactMoneyRegion, [
        ...confusedIncomePatterns,
        /(?:^|[^0-9%])([0-9OoIliSsBbZz]{2,4})(?:[^0-9%]|$)/,
      ]),
    );

  // 「總計 28 分鐘 (5.8 公里)」一行同時給時間與距離，優先採用。
  const total = compactNoClock.match(
    /(?:總計|合計|共)([0-9]{1,3})分鐘?[^0-9]{0,4}([0-9]{1,3}(?:\.[0-9]+)?)公里/,
  );

  return {
    income,
    distance:
      total?.[2] ??
      firstMatch(compactNoClock, [/([0-9]{1,3}(?:\.[0-9]+)?)(?:公里|公裡|km)/i]),
    minutes:
      total?.[1] ??
      firstMatch(compactNoClock, [
        /([0-9]{1,3})(?:分鐘|分|min|mins|minutes)/i,
      ]),
    stores: firstMatch(compactNoClock, [/(?:外送|訂單|取餐)\(([0-9]{1,2})\)/]),
    destination: parseDestination(lines),
  };
}

function clamp(value: number) {
  return Math.min(Math.max(value, 0), 100);
}

function normalize(value: number, low: number, high: number) {
  return clamp(((value - low) / (high - low)) * 100);
}

function includesArea(destination: string, areas: string[]) {
  return areas.some((area) =>
    destination.toLocaleLowerCase().includes(area.toLocaleLowerCase()),
  );
}

export function evaluate(fields: OrderFields): Decision {
  const income = Number(fields.income);
  const distance = Number(fields.distance);

  if (!income || !distance || income <= 0 || distance <= 0) {
    const reasons = [];
    if (!income || income <= 0) reasons.push("請確認訂單金額");
    if (!distance || distance <= 0) reasons.push("請確認配送距離");
    return {
      kind: "review",
      score: null,
      hourlyIncome: null,
      incomePerKm: null,
      reasons,
    };
  }

  const stores = Number(fields.stores) > 0 ? Number(fields.stores) : 1;
  const minutes =
    Number(fields.minutes) > 0
      ? Number(fields.minutes)
      : stores * 7 + distance * 4.2;
  const hourlyIncome = (income / minutes) * 60;
  const incomePerKm = income / distance;

  // 外送單不可能有這種效率，出現就代表金額或距離被 OCR 讀錯，寧可要求確認也不要亂建議。
  if (hourlyIncome > 900 || incomePerKm > 200) {
    return {
      kind: "review",
      score: null,
      hourlyIncome,
      incomePerKm,
      reasons: [
        `換算後時薪 $${Math.round(hourlyIncome)}、每公里 $${Math.round(incomePerKm)}，數字不合常理`,
        "請確認訂單金額與距離是否辨識正確",
      ],
    };
  }

  const isHot = includesArea(fields.destination, hotAreas);
  const isCold = includesArea(fields.destination, coldAreas);
  const destinationScore = isHot
    ? scoring.destination.hot
    : isCold
      ? scoring.destination.cold
      : scoring.destination.unknown;
  const returnScore = isHot
    ? scoring.returning.hot
    : isCold
      ? scoring.returning.cold
      : scoring.returning.unknown;
  const waitingScore =
    stores >= 3
      ? scoring.waiting.many
      : stores === 2
        ? scoring.waiting.double
        : scoring.waiting.single;

  const rawScore =
    normalize(hourlyIncome, scoring.hourly.low, scoring.hourly.high) *
      scoring.hourly.weight +
    normalize(incomePerKm, scoring.perKm.low, scoring.perKm.high) *
      scoring.perKm.weight +
    destinationScore * scoring.destination.weight +
    waitingScore * scoring.waiting.weight +
    returnScore * scoring.returning.weight;
  // 用顯示出來的分數決定接單與否，畫面才不會出現「60 分／不接」。
  const score = Math.round(rawScore);
  const kind = score >= scoring.acceptScore ? "accept" : "reject";
  const reasons: string[] = [];

  if (kind === "accept") {
    if (hourlyIncome >= 280) {
      reasons.push(`預估時薪 $${Math.round(hourlyIncome)}，效率良好`);
    } else {
      reasons.push(`預估時薪 $${Math.round(hourlyIncome)}，勉強達標`);
    }
    if (incomePerKm >= 22) {
      reasons.push(`每公里 $${Math.round(incomePerKm)}，距離效益良好`);
    }
    if (isHot) {
      reasons.push(`終點在${fields.destination}，送達後較容易留在熱區`);
    } else if (stores >= 2) {
      reasons.push(`${stores} 間店取餐，等餐時間可能拉長`);
    }
  } else {
    if (hourlyIncome < 240) {
      reasons.push(`預估時薪僅 $${Math.round(hourlyIncome)}，可能拉低效率`);
    }
    if (incomePerKm < 18) {
      reasons.push(`每公里僅 $${Math.round(incomePerKm)}，距離成本偏高`);
    }
    if (isCold) {
      reasons.push(`終點在${fields.destination}，空車回熱區風險較高`);
    } else if (stores >= 3) {
      reasons.push(`${stores} 間店取餐，等餐風險偏高`);
    }
  }

  if (!reasons.length) {
    reasons.push(
      kind === "accept" ? "綜合評分達到接單門檻" : "綜合評分未達接單門檻",
    );
  }

  return {
    kind,
    score,
    hourlyIncome,
    incomePerKm,
    reasons: reasons.slice(0, 3),
  };
}
