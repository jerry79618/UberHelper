import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

/**
 * 啟動時自動套用 migration。
 *
 * 為什麼不叫使用者手動跑 `npm run db:migrate`：
 * - Render 的 Shell 分頁是付費方案才有的功能，免費方案進不去。
 * - `db:migrate` 走 drizzle-kit，而 drizzle-kit 是 devDependency；Render
 *   建置時若 NODE_ENV=production 就不會安裝它，那個指令會找不到執行檔。
 *
 * 這裡改用 `drizzle-orm/node-postgres/migrator`——drizzle-orm 本身是正式
 * 依賴，讀的是已經 commit 進版控的 drizzle/ 資料夾裡的 SQL，不需要任何
 * 開發工具。migration 有自己的紀錄表，重複執行是安全的。
 *
 * 這裡刻意用一個獨立、用完就關的連線池，不共用 db/index.ts 那個長期存活的
 * 應用程式連線池：migration 是一次性的啟動工作，不該佔著應用程式的連線。
 * 也因此不 import 那個 .ts 模組（純 Node 無法解析 TypeScript 的無副檔名
 * import，那是靠 Vite 建置時處理的）。
 */
export async function runMigrations() {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    console.warn("[migrate] 沒有設定 DATABASE_URL，跳過 migration。");
    return;
  }

  const pool = new Pool({
    connectionString,
    // 跟 db/index.ts 一致：Render 的受管 Postgres 需要 SSL，但憑證不是
    // 公開 CA 簽的；本機接 localhost 測試時關掉。
    ssl: connectionString.includes("localhost")
      ? false
      : { rejectUnauthorized: false },
  });

  try {
    await migrate(drizzle(pool), { migrationsFolder: "./drizzle" });
    console.log("[migrate] migration 已套用完成。");
  } finally {
    await pool.end();
  }
}
