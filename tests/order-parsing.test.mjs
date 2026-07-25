import assert from "node:assert/strict";
import test from "node:test";
import { evaluate, parseOrderText } from "../app/order.ts";

// 以下兩份都是實際跑 tesseract.js 對真實截圖辨識後「原封不動」複製下來的輸出，
// 不是手打的乾淨範例。LSTM 對這種深色底、有地圖背景的卡片辨識品質很差：中文
// 常常一字一格、夾雜大量雜訊符號，金額本身甚至完全沒被讀出來。用假造的乾淨
// 範例寫測試曾經讓兩個真實 bug（換行黏字、字元白名單讓輸出整個消失、地址被
// OCR 斷行拆成兩段）都沒被抓到，所以改成釘住真實輸出，不要再改乾淨。

// 2026-07-25 實測：NT$118、外送(2)、總計 28 分鐘 (5.8 公里)，送信義區吳興街。
// 第一階段 LSTM 完全沒讀到金額（整段被吃成雜訊符號），要靠金額框重掃。
const stage1Text118 = `人
16:37 94 oll T 98%
9
i []
ed .
>»
&
7
4
全
1 —E&
MN
當
A 說
外 外 送 (2) Es ll:
© 總 計 28 分 鐘 (5.8 公里 )
| 北 一 菜 盒 店
? MEERA REE
| 110 台 灣 臺北 市 信義 區 贅 順 里 基 隆 路 二
| 段 171 號
1 110 台 灣 臺北 市 信義 區 惠安 里 吳 興 街 432
巷 150 號
接受
2
ony`;
// 金額框重掃改用傳統（legacy）引擎後的實際輸出，前後帶著雜訊引號。
const stage2Money118 = "‘ NT$118 ‘\n";

test("金額框全靠雜訊、要靠 legacy 重掃時仍讀得出金額、時間、距離與店家數", () => {
  const fields = parseOrderText(stage1Text118, stage2Money118);

  assert.equal(fields.income, "118");
  assert.equal(fields.minutes, "28");
  assert.equal(fields.distance, "5.8");
  assert.equal(fields.stores, "2");
});

test("地址被 OCR 斷成兩行（區在一行、路在下一行）仍能合併判斷終點", () => {
  const fields = parseOrderText(stage1Text118, stage2Money118);

  assert.equal(fields.destination, "信義區吳興街");
});

// 2026-07-26 實測：NT$45、總計 10 分鐘 (1.9 公里)、單間店家、送信義區松山路。
// 這張金額第一階段就讀到了，不需要金額重掃。
const singleOrderScreenshot = `r 3 wv
Ch A 7 lw ow
+ pg ge (3 2,
< 0
永吉 路 萬 神 公園
ee]
= KEE 器 ® (4
= 下 成 :
GEE EC | 成
sO
Cl Teal EY
2 . 福 德 公園 | 信義
©
D s
康 公 轅 ®
A SE) == x
I
NT$45
4 -~
., G 總 計 10 分 鐘 (1.9 公里 )
"| 『 有 煎 餃 子 館 新 松 德 館
AN | 110062 台 灣 臺 北市 信義 區 四 維 里 松山
路 242 號
接受
2)`;

test("金額第一階段就讀到時不需要重掃，時間、距離、終點也正確", () => {
  const fields = parseOrderText(singleOrderScreenshot);

  assert.equal(fields.income, "45");
  assert.equal(fields.minutes, "10");
  assert.equal(fields.distance, "1.9");
  assert.equal(fields.destination, "信義區松山路");
});

test("這張 $45 / 1.9km / 10 分的單會建議接單", () => {
  const decision = evaluate(parseOrderText(singleOrderScreenshot));

  assert.equal(decision.kind, "accept");
  assert.equal(Math.round(decision.hourlyIncome), 270);
  assert.equal(Math.round(decision.incomePerKm), 24);
});

test("金額被讀錯導致效率離譜時要求確認，不給接單建議", () => {
  const decision = evaluate({
    income: "454",
    distance: "1.9",
    minutes: "10",
    stores: "1",
    destination: "信義區松山路",
  });

  assert.equal(decision.kind, "review");
  assert.equal(decision.score, null);
  assert.match(decision.reasons.join(""), /不合常理/);
});

test("狀態列的時鐘與電量不會被當成金額或時間", () => {
  const fields = parseOrderText("16:37 98\n$118\n總計 28 分鐘 (5.8 公里)");

  assert.equal(fields.income, "118");
  assert.equal(fields.minutes, "28");
});

test("NT$ 被辨識成 NTS 或 NT5 時仍抓得到金額", () => {
  assert.equal(parseOrderText("NTS118").income, "118");
  assert.equal(parseOrderText("NT5118").income, "118");
});

test("金額數字被讀成字母時能還原", () => {
  assert.equal(parseOrderText("NTSI18").income, "118");
  assert.equal(parseOrderText("NT$1l8").income, "118");
  assert.equal(parseOrderText("NT$4S").income, "45");
  assert.equal(parseOrderText("$1I8").income, "118");
});

test("整行都是字母時不會硬湊成數字", () => {
  assert.equal(parseOrderText("NT$SOS").income, "");
  assert.equal(parseOrderText("外送\n獨享\n接受").income, "");
});

test("地圖上的熱區路名不會蓋掉冷區終點", () => {
  const fields = parseOrderText(`松仁路
信義快速道路
NT$95
總計 30 分鐘 (7.2 公里)
110台灣臺北市文山區木柵路三段100號`);

  assert.equal(fields.destination, "文山區木柵路三段");
  assert.equal(evaluate(fields).kind, "reject");
});

test("這張 $118 / 5.8km / 28 分的信義區單會建議接單", () => {
  const decision = evaluate(parseOrderText(stage1Text118, stage2Money118));

  assert.equal(decision.kind, "accept");
  assert.ok(decision.score !== null && decision.score >= 60);
  assert.equal(Math.round(decision.hourlyIncome), 253);
  assert.equal(Math.round(decision.incomePerKm), 20);
});

test("顯示分數與接單判斷一致", () => {
  for (let income = 60; income <= 400; income += 1) {
    for (const destination of ["信義區吳興街", "", "文山區木柵路"]) {
      const decision = evaluate({
        income: `${income}`,
        distance: "5.8",
        minutes: "28",
        stores: "1",
        destination,
      });
      const expected = decision.score >= 60 ? "accept" : "reject";
      assert.equal(decision.kind, expected, `${income} / ${destination}`);
    }
  }
});

test("金額或距離缺一就要求確認，不硬判", () => {
  assert.equal(evaluate(parseOrderText("總計 28 分鐘 (5.8 公里)")).kind, "review");
  assert.equal(evaluate(parseOrderText("NT$118")).kind, "review");
});
