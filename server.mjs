import { inspect } from "node:util";

/**
 * 正式環境的啟動入口（Render 用這個，不要用 `vinext start`）。
 *
 * 為什麼不用 `vinext start`：那個指令的 CLI 最上面靜態 import 了 vinext 的
 * Vite 外掛（只有開發和建置才需要），連帶把 vite → rolldown → rolldown 的
 * watch 模組整串拉進正式環境。實測確認光是載入那個模組就會覆寫全域的
 * `process.emit`。它對錯誤事件只是原封轉發、不會自己產生錯誤，但會擋在
 * 堆疊中間讓崩潰訊息更難追，而且正式環境本來就不該載入整套開發工具鏈。
 * 直接載入底層的 prod-server 就乾淨得多（實測 `process.emit` 保持原樣）。
 */

// 這兩個監聽器一定要在 startProdServer 之前註冊。vinext 會在啟動時安裝自己的
// 「socket 錯誤防護網」，那個防護網對非網路斷線的錯誤會原封不動重新拋出，
// 導致整個程序以 status 7 崩潰、而 log 只印得出 `throw err` 和一個沒有內容的
// `undefined`，完全無從追查。先註冊的監聽器會先執行，這裡負責在崩潰之前
// 把錯誤的真實內容記錄下來。
process.on("unhandledRejection", (reason, promise) => {
  console.error(
    "[server] 未處理的 Promise 拒絕:",
    inspect(reason, { depth: 5 }),
    "\n  來源 promise:",
    inspect(promise, { depth: 2 }),
  );
});

process.on("uncaughtException", (error, origin) => {
  console.error(
    `[server] 未捕捉的例外 (來源: ${origin}):`,
    inspect(error, { depth: 5 }),
  );
});

// 先套用 migration 再開始服務，這樣第一次部署就有資料表可用。失敗不擋啟動：
// 網站本身（截圖分析）不需要資料庫，只有 /history 會受影響，硬是不啟動反而更糟。
try {
  const { runMigrations } = await import("./db/migrate.mjs");
  await runMigrations();
} catch (error) {
  console.error(
    "[server] migration 失敗，網站照常啟動，但 /history 會讀不到記錄:",
    inspect(error, { depth: 5 }),
  );
}

const { startProdServer } = await import("vinext/server/prod-server");

const port = Number(process.env.PORT ?? 3000);

await startProdServer({ port, host: "0.0.0.0" });
