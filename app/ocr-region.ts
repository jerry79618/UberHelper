export type OcrLine = { text: string; top: number; bottom: number };

export type Rectangle = {
  left: number;
  top: number;
  width: number;
  height: number;
};

type RawLine = { text: string; bbox: { y0: number; y1: number } };
type RawParagraph = { lines?: RawLine[] | null };
type RawBlock = { paragraphs?: RawParagraph[] | null };

/** 攤平 tesseract 的 blocks，只留下每行文字與它的垂直位置。 */
export function flattenLines(
  blocks: RawBlock[] | null | undefined,
): OcrLine[] {
  const lines: OcrLine[] = [];

  for (const block of blocks ?? []) {
    for (const paragraph of block.paragraphs ?? []) {
      for (const line of paragraph.lines ?? []) {
        lines.push({
          text: line.text.trim(),
          top: line.bbox.y0,
          bottom: line.bbox.y1,
        });
      }
    }
  }

  return lines;
}

/** 卡片高度會隨停靠點數量變動，抓不到座標時才退回固定比例。 */
export function fallbackMoneyRectangle(
  width: number,
  height: number,
): Rectangle {
  return {
    left: 0,
    top: Math.round(height * 0.4),
    width,
    height: Math.round(height * 0.3),
  };
}

/**
 * 金額夾在「外送／獨享」標籤與「總計 X 分鐘」之間，用這兩行的座標把它框出來，
 * 比用整張圖的固定比例可靠得多。
 */
export function moneyRectangle(
  lines: OcrLine[],
  width: number,
  height: number,
): Rectangle {
  // LSTM 對這種深色卡片常一字一格輸出（"總 計"、"外 外 送"），比對前先去空白，
  // 不然「總計」「外送」這種兩字詞會被拆開而完全比對不到。
  const noSpace = (line: OcrLine) => line.text.replace(/\s+/g, "");
  const total = lines.find((line) => /總計|合計|公里|分鐘/.test(noSpace(line)));
  if (!total) return fallbackMoneyRectangle(width, height);

  const lineHeight = Math.max(total.bottom - total.top, 20);
  const badge = lines.find(
    (line) =>
      /外送|獨享|拼單/.test(noSpace(line)) && line.bottom < total.top,
  );
  const top = Math.max(
    0,
    Math.round(badge ? badge.bottom + 4 : total.top - lineHeight * 4),
  );
  const bottom = Math.round(total.top - lineHeight * 0.2);
  if (bottom - top < 20) return fallbackMoneyRectangle(width, height);

  return { left: 0, top, width, height: Math.min(bottom - top, height - top) };
}
