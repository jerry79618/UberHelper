import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

let pool: Pool | undefined;

/**
 * Render 的 Postgres 連線字串（Internal 或 External Database URL）。本機開發
 * 用 .env.local 提供同名變數指向本機或遠端測試用的 Postgres。
 */
export function getDb() {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error(
      "環境變數 DATABASE_URL 未設定。本機開發請在 .env.local 加入 Postgres 連線字串；" +
        "部署到 Render 時，把 Postgres 服務的 Internal Database URL 設成這個 Web Service 的環境變數。",
    );
  }

  if (!pool) {
    pool = new Pool({
      connectionString,
      // Render 的受管 Postgres 需要 SSL，但憑證不是公開 CA 簽的；本機接
      // localhost 測試時關掉即可。
      ssl: connectionString.includes("localhost")
        ? false
        : { rejectUnauthorized: false },
    });
    // pg 的 Pool 是 EventEmitter：閒置連線背景出錯時會 emit "error"，
    // 沒人監聽的話 Node 會把整個程序當成未處理例外直接炸掉。這裡接住、
    // 印出來就好，不能讓一個閒置連線的問題搞垮整個網站。
    pool.on("error", (error) => {
      console.error("[db] idle Postgres client error:", error);
    });
  }

  return drizzle(pool, { schema });
}
