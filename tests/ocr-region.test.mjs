import assert from "node:assert/strict";
import test from "node:test";
import {
  fallbackMoneyRectangle,
  flattenLines,
  moneyRectangle,
} from "../app/ocr-region.ts";

// 2026-07-26 實測的 NT$118 截圖（868 × 1887）用 tesseract.js 實際跑出來的
// blocks 攤平結果，原封不動複製下來，不是手打的乾淨座標。LSTM 對這張深色卡片
// 的辨識很破碎，「總計」「外送」這種詞常被拆成「總 計」「外 外 送」，這份
// fixture 就是用來釘住「就算被拆字也要抓對範圍」這件事。實際裁圖 + legacy
// 引擎重掃驗證過：不管是抓到標籤列、還是退回估算，算出來的框都讀得到 NT$118。
const IMAGE_WIDTH = 868;
const IMAGE_HEIGHT = 1887;

const badgeLine = { text: "外 外 送 (2) Es ll:", top: 921, bottom: 991 };
const totalLine = {
  text: "© 總 計 28 分 鐘 (5.8 公里 )",
  top: 1179,
  bottom: 1216,
};
const cardLines = [
  { text: "16:37 94 oll T 98%", top: 51, bottom: 98 },
  badgeLine,
  totalLine,
  { text: "| 北 一 菜 盒 店", top: 1268, bottom: 1339 },
];

test("抓到標籤列（就算被拆字）時，框從標籤列下緣開始，且不會碰到總計列", () => {
  const rect = moneyRectangle(cardLines, IMAGE_WIDTH, IMAGE_HEIGHT);

  assert.equal(rect.top, badgeLine.bottom + 4);
  assert.ok(
    rect.top + rect.height <= totalLine.top,
    `下緣 ${rect.top + rect.height} 不該碰到總計列 top=${totalLine.top}`,
  );
  assert.ok(rect.height > 100, "框應該有合理高度才能包住大字的價格");
});

test("沒有標籤列時往總計上方推四行高，仍然是個合理的框", () => {
  const withoutBadge = cardLines.filter((line) => line !== badgeLine);
  const rect = moneyRectangle(withoutBadge, IMAGE_WIDTH, IMAGE_HEIGHT);
  const lineHeight = totalLine.bottom - totalLine.top;

  assert.equal(rect.top, totalLine.top - lineHeight * 4);
  assert.ok(rect.top + rect.height <= totalLine.top);
});

test("完全找不到總計那一行就退回固定比例", () => {
  const rect = moneyRectangle(
    [{ text: "接受", top: 1600, bottom: 1650 }],
    IMAGE_WIDTH,
    IMAGE_HEIGHT,
  );

  assert.deepEqual(rect, fallbackMoneyRectangle(IMAGE_WIDTH, IMAGE_HEIGHT));
});

test("標籤列在總計下方時要忽略，不能讓框變成負高度", () => {
  const rect = moneyRectangle(
    [
      { text: "總計 10 分鐘 (1.9 公里)", top: 1155, bottom: 1195 },
      { text: "外送 獨享", top: 1300, bottom: 1350 },
    ],
    IMAGE_WIDTH,
    IMAGE_HEIGHT,
  );

  assert.ok(rect.height > 0);
  assert.ok(rect.top < 1155);
});

test("攤平 tesseract 的 blocks", () => {
  const lines = flattenLines([
    {
      paragraphs: [
        {
          lines: [
            { text: " NT$118 \n", bbox: { y0: 1005, y1: 1080 } },
            { text: "總計 28 分鐘", bbox: { y0: 1155, y1: 1195 } },
          ],
        },
      ],
    },
    { paragraphs: null },
  ]);

  assert.deepEqual(lines, [
    { text: "NT$118", top: 1005, bottom: 1080 },
    { text: "總計 28 分鐘", top: 1155, bottom: 1195 },
  ]);
  assert.deepEqual(flattenLines(null), []);
});
