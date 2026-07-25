import { sql } from "drizzle-orm";
import {
  doublePrecision,
  integer,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

export const orderHistory = pgTable("order_history", {
  id: text("id").primaryKey(),
  recordedAt: timestamp("recorded_at", { withTimezone: true })
    .notNull()
    .default(sql`now()`),
  income: doublePrecision("income").notNull(),
  distance: doublePrecision("distance").notNull(),
  minutes: doublePrecision("minutes"),
  stores: integer("stores").notNull().default(1),
  destination: text("destination").notNull().default(""),
  decision: text("decision").notNull(),
  score: integer("score"),
  // 記錄請求來源 IP，方便確認手機、電腦、不同網路上傳的記錄真的有集中進來。
  source: text("source"),
});
