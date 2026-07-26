# 變更紀錄

UberHelper web 的所有修改都記在這裡，最新的日期放最上面。

## 2026-07-27（傍晚）

- **migration 改成啟動時自動套用，不需要 Shell**（[db/migrate.mjs](db/migrate.mjs)、[server.mjs](server.mjs)）— `/history` 顯示 `relation "order_history" does not exist`，資料表從來沒被建立。原本我叫使用者去 Render 的 Shell 跑 `npm run db:migrate`，查證後發現這條路走不通：**Render 的 Shell 是付費方案才有的功能**，免費方案進不去；而且 `db:migrate` 走的是 drizzle-kit，那是 devDependency，Render 若以 `NODE_ENV=production` 建置根本不會安裝它。改成伺服器啟動時用 `drizzle-orm/node-postgres/migrator`（drizzle-orm 是正式依賴）讀取已 commit 的 `drizzle/` SQL 自動套用。migration 失敗只記錄不擋啟動——截圖分析本身不需要資料庫，只有 `/history` 受影響，硬是不啟動反而更糟。
- **首次真正驗證資料庫這一塊**（[tests/migration.test.mjs](tests/migration.test.mjs)）— 之前的資料庫程式碼只驗證過「型別過、build 過」，從來沒接上真正的 Postgres。裝了 `@electric-sql/pglite`（真正的 Postgres 編譯成 WASM，devDependency）寫了 4 個測試：migration 能在真 Postgres 上套用、資料表欄位跟 schema 一致、重複套用安全（啟動時每次都會跑）、寫入讀取完整往返（含 null 與預設值）。**仍未涵蓋**：`pg` 驅動本身、連線字串解析、Render 受管 Postgres 的 SSL 設定——那些只有接上真的遠端資料庫才驗得到。

## 2026-07-27（下午）

- **支援包裹單，修掉三個用真實截圖重現的解析 bug**（[app/order.ts](app/order.ts)、[app/ocr-region.ts](app/ocr-region.ts)）— 使用者回報一張 NT$249 的包裹單解析錯誤。直接對磁碟上的真實截圖跑 tesseract.js（見 [[ocr-debugging-approach]]），三個問題都完整重現：
  1. **站點代號被當成金額**：`MOMO 富昇 一般件 內湖站 Nt21` 裡的 `Nt21` 被 `NT[$S5]?` 這個「貨幣符號可有可無」的規則吃下去，income 變成 `21`，時薪算出 $42 判「不接」；更糟的是因為誤抓到值，legacy 金額重掃根本不會被觸發。改成不限整行時**貨幣符號必須存在**（整行只有 `NT249` 的情況仍允許缺符號）。
  2. **包裹單地址順序相反**：外送單是「郵遞區號→市→區→路」（`110台灣臺北市信義區…吳興街432巷150號`），包裹單是「路→區→市→郵遞區號」（`康寧路3段190巷17號 2樓, 內湖區, 臺北市 114`）。原本只在行政區「之後」找路名，包裹單就只抓到 `內湖區`、路名整段丟失。改成區之後找不到就往區之前找。順帶讓段號支援阿拉伯數字（`康寧路3段`，原本只認國字如 `基隆路二段`）。
  3. **「包裹 (2)」標籤 OCR 讀不出來**：那個標籤是白字配深綠圓底，實測整行完全沒被辨識（跟金額同樣的低對比問題），所以無法靠改正則解決。改成標籤讀不到時**退回數地址行數**（連續的地址區塊，扣掉最後一個送達點）來推算取件點數——地址列辨識穩定得多。
  - 四張真實截圖（$249 包裹、$414 包裹(2)、$118 外送(2)、$45 外送）現在全部解析正確，並用真實 OCR 輸出補了 5 個迴歸測試。
- **資料庫錯誤訊息改成顯示真正的原因**（[app/history/page.tsx](app/history/page.tsx)、[app/api/history/route.ts](app/api/history/route.ts)）— `/history` 頁面只顯示 `Failed query: select ...` 一長串 SQL，完全看不出為什麼失敗，因為 Drizzle 把真正的原因（例如「資料表不存在」）放在 `cause` 鏈上而不是 `message`。改成往下走 cause 鏈把原因取出來，並在偵測到資料表不存在時直接告訴使用者要執行 `npm run db:migrate`。伺服器端也會 `console.error` 完整堆疊。

## 2026-07-27

- **修復 Render 上啟動幾秒後就崩潰（Exited with status 7）**（[.node-version](.node-version)、[render.yaml](render.yaml)、[server.mjs](server.mjs)、[package.json](package.json)）— log 裡只有 `throw err` 和一個沒有內容的 `undefined`，完全無從追查。加上 `NODE_OPTIONS=--trace-uncaught` 拿到真正的堆疊後才查出完整因果鏈：某處產生一個**值為 `undefined` 的未處理 Promise 拒絕** → vinext 的 socket 錯誤防護網照設計把非網路斷線的錯誤原封不動重新拋出 → 程序以 status 7 死亡。本機用 `Promise.reject(undefined)` + vinext 的防護網**完整重現了一模一樣的崩潰**（同樣的檔案行號、同樣的 `undefined`、同樣的結束代碼 7），確認因果鏈無誤。
  - **根本原因判定為 Node 版本**：本機 Node 24.18.0 跑同一份正式建置完全穩定（各種請求、突然斷線的 TCP 連線都撐得住），Render 因為沒指定版本抓了最新的 **Node 26.5.0**，而這個專案用的 `vinext` 是 `0.0.50`（相當早期，套件庫上最新已是 `1.0.0-beta.4`）。用 `.node-version` 和 `render.yaml` 的 `NODE_VERSION` 把版本釘在 24.18.0，`engines` 也改成 `>=22.13.0 <26` 讓不相容能提早被擋下。
  - **啟動方式從 `vinext start` 改成自己的 [server.mjs](server.mjs)**：查證發現 `vinext start` 的 CLI 最上面靜態 import 了它的 Vite 外掛（只有開發／建置需要），連帶把 vite → rolldown → rolldown 的 watch 模組整串拉進正式環境，實測光是載入就會**覆寫全域的 `process.emit`**。它對錯誤事件只是原封轉發、不是崩潰的源頭（原本一度誤判是它造成的，讀完它的訊號處理邏輯後修正），但會擋在堆疊中間讓崩潰更難追，正式環境也本來就不該載入整套開發工具鏈。改成直接載入 vinext 官方匯出的 `vinext/server/prod-server`（實測 `process.emit` 保持原樣）。
  - **[server.mjs](server.mjs) 裡在啟動伺服器之前先註冊診斷用的 `unhandledRejection` / `uncaughtException` 監聽器**，因為先註冊的會先執行，就能在 vinext 的防護網把程序弄死之前，先把錯誤的真實內容印進 log。之後若再遇到類似的無訊息崩潰，就有東西可以看。
- **修正 `pg` 連線池缺少 error 監聽器**（[db/index.ts](db/index.ts)）— Postgres 的 Pool 是 EventEmitter，閒置連線背景出錯時若沒人監聽 `"error"`，Node 會直接讓整個程序崩潰。這是 `pg.Pool` 本來就該有的基本防護，補上。（一度以為這是 Render 崩潰的原因，但後續 log 沒出現這行訊息，證實不是同一件事——不過這個修正本身仍然必要。）

## 2026-07-26（深夜）

- **推上 GitHub**（`github` remote，`https://github.com/jerry79618/UberHelper.git`）— 使用者要把這份程式碼放到自己的 GitHub，之後要部署到 Render。本機已建好 commit，push 這一步因為權限機制擋下自動化操作，需要使用者自己手動執行 `git push -u github main`。
- **記錄改成集中存到 Postgres，不再只存在單一裝置的 localStorage**（[db/schema.ts](db/schema.ts)、[db/index.ts](db/index.ts)、[app/api/history/route.ts](app/api/history/route.ts)、[app/history/page.tsx](app/history/page.tsx)）— 使用者想要的是「不論手機、電腦、哪個 IP 上傳都要集中在一起，每天在電腦上看」，這在架構上跟前一版的 localStorage 方案（[[uberhelper-web-overview]] 提過的隱私設計）互斥，因為 localStorage 是各裝置各自獨立的。改用真正的資料庫：新增 `order_history` 資料表（金額、距離、時間、店家數、目的地、判斷、分數、來源 IP），OCR 分析完成後前端 POST 給 `/api/history` 寫入；新頁面 `/history`（Server Component，直接查資料庫，`force-dynamic` 不做靜態預先渲染）依台北日曆日分組顯示所有記錄與每日小結，不顯示在首頁（首頁只留一個「查看所有記錄」連結）。
- **資料庫從 Cloudflare D1 換成 Postgres**（[db/index.ts](db/index.ts)、[db/schema.ts](db/schema.ts)、[drizzle.config.ts](drizzle.config.ts)）— 原本一度想直接用專案內建的 D1 範例架構做集中記錄，但查證後發現 D1 是 Cloudflare Workers 專屬的，`import { env } from "cloudflare:workers"` 在 Render 的一般 Node.js 環境下根本無法載入；已讀過 `vinext start` 原始碼確認它是不依賴 Cloudflare 執行環境的 Node HTTP server，能直接部署到 Render，所以資料庫要換成 Render 相容的 Postgres 才不會衝突。改用 `drizzle-orm/node-postgres` + `pg`，透過 `DATABASE_URL` 環境變數連線，Render 的受管 Postgres 需要 SSL（本機接 localhost 時關閉）。
- **移除已經過時、跟現況不符的 D1 範例**（`examples/d1/`）— 換成 Postgres 之後這個範例的 sqlite schema 跟 `db/index.ts` 的型別不相容，而且從來沒有真正的程式碼在用它，留著只會一直報型別錯誤，直接刪除並更新 README 的說明。
- **新增 `render.yaml`**，用 Render 的 Blueprint 一次建好 Web Service 和 Postgres 資料庫、自動把連線字串接成 `DATABASE_URL` 環境變數；也加了 `npm run db:migrate`（`drizzle-kit migrate`）供第一次部署後手動套用資料表 migration。**這個檔案沒有實際在 Render 上跑過，欄位是照 Render Blueprint 文件的一般寫法寫的，第一次用請對照 Render 當下的文件確認。**
- **這次的資料庫程式碼沒有接到真正的 Postgres 測試過**——本機環境沒有 Docker 也沒有本機 Postgres，只驗證了：型別檢查通過、build 成功、`DATABASE_URL` 沒設定時 `/history` 和 `/api/history` 會顯示清楚的錯誤訊息而不會讓整個網站掛掉。真正的讀寫（insert/select、SSL 連線、migration 有沒有套用成功）要等接上真的 Postgres（本機或 Render）才能確認。

## 2026-07-26（晚上）

- **新增「今日記錄」功能**（[app/history.ts](app/history.ts)、[app/page.tsx](app/page.tsx)、[app/globals.css](app/globals.css)）— 使用者發現目前完全沒有記錄任何上傳結果，每次分析完換下一張就消失了。加上本機記錄：每次 OCR 分析完成（不管結果是接單／不接／確認資料）都會存一筆金額、距離、時間、店家數、目的地、建議、分數到瀏覽器的 `localStorage`（key: `uberhelper.history.v1`，只存數字結果，不存圖片，符合「圖片留在裝置、不上傳」的既有隱私承諾）。畫面新增「今日記錄」區塊，顯示今天筆數、建議接單筆數、接單預估收入加總，以及逐筆列表；有「清除今日記錄」按鈕。
- **讀取 localStorage 用 `useSyncExternalStore`，不用 `useEffect+setState`**（[app/history.ts](app/history.ts)、[app/page.tsx](app/page.tsx)）— 一開始用 `useEffect` 掛載後讀取，被 eslint 的 `react-hooks/set-state-in-effect` 規則擋下（這個寫法會造成多餘的重新渲染）。localStorage 是「SSR 時不存在、掛載後才有」的外部資料來源，正是 `useSyncExternalStore` 設計要處理的情境：伺服器與客戶端首次渲染都吃 `getServerHistorySnapshot()`（固定回傳空陣列），避免 hydration 不一致；掛載後才切換成瀏覽器裡的真正資料。

## 2026-07-26（下午）

- **找到金額真正讀不到的根本原因，不再靠猜**（[app/page.tsx](app/page.tsx)、[app/order.ts](app/order.ts)、[app/ocr-region.ts](app/ocr-region.ts)）— 前兩輪的換行黏字修正、字元白名單、字母數字還原都只是在猜 OCR 讀成什麼，這次直接在本機用 tesseract.js 對使用者實際截圖跑辨識，抓到兩個真正的根因：
  1. **`tessedit_char_whitelist` 在 LSTM 引擎下會讓辨識整個失效**（已知的 Tesseract/LSTM 相容性問題）。前一版加的數字白名單本意是防止「1」被讀成「I」，實際效果卻是讓金額那行的輸出從「NI$llo」這種還能辨認的近似值，退化成幾乎空白的「NT$」甚至完全空字串。已移除白名單。
  2. **金額重掃改用傳統（legacy）引擎，不用 LSTM。** 這張卡片是深色底配大字體白字，LSTM 對此類版面辨識品質很差；用同一個裁切區塊測試，legacy 引擎穩定讀出正確的「NT$118」（重複 3 次結果一致），LSTM 則完全讀不到或讀成亂碼。金額重掃現在會另外建立一個 `OEM.TESSERACT_ONLY`、僅載入 `eng` 的 worker，跟原本的 `eng+chi_tra` LSTM worker分開，用完即釋放。
- **金額框的座標比對也要先去空白**（[app/ocr-region.ts](app/ocr-region.ts)）— LSTM 對深色卡片常一字一格輸出（「總 計」「外 外 送」），原本抓「外送／獨享」標籤列和「總計」列的正則因為字元間插了空白而比對不到，一路退回精度較低的估算分支。改成比對前先去除每行內部空白。
- **地址被 OCR 斷行時能合併判斷終點**（[app/order.ts](app/order.ts)）— 同樣的斷字問題也發生在地址：「信義區」和「松山路242號」有時被拆到不同行，單行比對兩者都會落空。改成往回最多合併三行再判斷是不是地址，解決後兩張實測截圖的終點都能正確讀出「信義區吳興街」「信義區松山路」。
- **測試改成釘住真實 OCR 輸出，不用手打的乾淨範例**（[tests/order-parsing.test.mjs](tests/order-parsing.test.mjs)、[tests/ocr-region.test.mjs](tests/ocr-region.test.mjs)）— 之前用手打的「乾淨」截圖文字寫測試，兩個真實 bug（字元白名單讓輸出消失、地址被斷行拆開）都沒被測出來，因為手打範例從來沒出現過真實 OCR 那種破碎程度。改用磁碟上使用者實際截圖（`S__132669524.jpg`、`S__132669525.jpg`）跑 tesseract.js 得到的原始輸出當測試 fixture。

## 2026-07-26

- **金額改用座標定位 + 數字白名單重掃**（[app/ocr-region.ts](app/ocr-region.ts)、[app/page.tsx](app/page.tsx)）— NT$118 的單完全讀不到金額，而放寬正則沒有解決。改成用 tesseract 回傳的每行座標，找到「總計 X 分鐘」那一行，往上取到「外送／獨享」標籤列之間的區塊當作金額範圍，並把 `tessedit_char_whitelist` 限制成 `NT$0123456789.`，讓「1」在辨識階段就不可能被輸出成「I」或「l」。幾何計算用實測截圖量到的座標寫了測試釘住。
- **辨識不完整時自動攤開 OCR 原始文字**（[app/page.tsx](app/page.tsx)）— 金額或距離沒讀到時直接展開，不用再自己去點。
- **金額支援 OCR 字母誤判還原**（[app/order.ts](app/order.ts)）— 實測 NT$118 的單完全抓不到金額，推測是大字被讀成 `NTSI18`、`NT$1l8` 這類字母數字混雜的結果。只在確認是金額那一行時把 `O I l i S s B b Z z` 還原成數字，且原字串必須本來就含數字、還原後必須全是數字才採用，避免把 `SOS` 硬湊成 `505`。
- **OCR 原始文字加上複製鈕**（[app/page.tsx](app/page.tsx)）— 辨識失敗時要能把原始文字直接交出來比對，不然只能靠猜。
- **修正金額被黏上下一行雜訊的 bug**（[app/order.ts](app/order.ts)）— 實測 NT$45 的單被讀成 454，換算出時薪 $2724 還照樣建議接單。原因是比對前用 `\s+` 把換行也清掉，金額獨佔一行，下一行開頭的時鐘圖示被 OCR 讀成數字後就黏在金額後面。改成只清行內空白、保留換行，並優先比對「整行就是 NT$xxx」的樣式。
- **加上效率離譜就要求確認的保險**（[app/order.ts](app/order.ts)）— 換算後時薪超過 $900 或每公里超過 $200 時改判「確認資料」，不再給接單建議。這種數字只可能來自 OCR 讀錯。
- **升級本機 Node 22.13.1 → 24.18.0 LTS**（winget `OpenJS.NodeJS.LTS`）— 舊版在這個環境會讓 `tsc`、`eslint`、`vinext build` 全部 access violation 崩潰且不吐任何訊息，工作目錄含中文「文件」時連 `require('./檔案')` 都會 segfault。升級後全數正常，`npm test`（建置 + 9 個測試）通過。
- **npm 腳本改成跨平台可執行**（[package.json](package.json)）— `dev` / `build` / `start` 拿掉 `WRANGLER_LOG_PATH=... ` 這種 POSIX 前綴，Windows 的 cmd 無法解析、`npm run build` 一律失敗；[vite.config.ts](vite.config.ts) 本來就會在載入 Cloudflare plugin 前設定同一個變數，所以行為不變。`test` 的路徑改用 glob，Node 24 不再接受直接傳資料夾。
- **忽略 `*.tsbuildinfo`**（[.gitignore](.gitignore)）— `tsc` 產生的增量快取不該進版控。
- **調降接單門檻**（[app/order.ts](app/order.ts)）— 實測 NT$118 / 5.8 公里 / 28 分鐘的信義區雙拼單被判「不接」，門檻明顯過嚴。時薪級距由 $160–420 改成 $150–350，每公里由 $12–40 改成 $10–32，終點分數由 90/50/20 改成 90/55/25，回熱區由 90/50/15 改成 90/55/20。60 分的接單門檻維持不變，但同一張單現在得 62 分、判定接單。
- **等餐風險改成真的會變動**（[app/order.ts](app/order.ts)）— 原本寫死 60 分，等於這 10% 權重完全沒作用。改為依取餐店家數計分（1 間 70、2 間 55、3 間以上 40），並新增「取餐店家數」欄位，OCR 會從「外送 (2)」自動帶入。沒填時間時的估算也一併改成 `店家數 × 7 + 距離 × 4.2` 分鐘。
- **終點改抓停靠點清單的最後一筆地址**（[app/order.ts](app/order.ts)）— 派單畫面沒有「目的地」標籤，舊版退回全圖關鍵字掃描，會把地圖上的路名標籤（松仁路、信義快速道路）當成終點，導致送往木柵的單被當成熱區加分。現在改成解析地址列並取最後一筆，再收斂成「信義區吳興街」這種短標籤。
- **狀態列不再污染辨識結果**（[app/order.ts](app/order.ts)）— 比對前先移除 `16:37` 這類時鐘字串，金額的區域重掃也排除百分比數字，避免把電量或時間讀成金額。時間與距離優先從「總計 28 分鐘 (5.8 公里)」整行取值。
- **修正分數顯示與判斷不一致**（[app/order.ts](app/order.ts)）— 改用四捨五入後的分數做判斷，不會再出現畫面顯示「60 分」卻結論「不接」。
- **抽出 [app/order.ts](app/order.ts) 並補上單元測試**（[tests/order-parsing.test.mjs](tests/order-parsing.test.mjs)）— 解析與評分從 `app/page.tsx` 移出成純函式模組，用實測截圖的文字寫了 8 個測試。`npm test` 改成 `node --experimental-strip-types --test tests/`。
- **熱區清單補上吳興街、基隆路二段、忠孝東路、光復南路，冷區補上汐止**（[app/order.ts](app/order.ts)）。

## 2026-07-25

- **建立這份變更紀錄** — 使用者要求之後每次修改都要留紀錄，同時把專案背景寫進 Claude 的長期記憶。
- **改善訂單金額的 OCR 補救流程**（`4b364fa`，[app/page.tsx](app/page.tsx)）— 第一次全圖辨識抓不到金額時，改用 `PSM.SINGLE_BLOCK` 針對截圖中段的金額區塊（`moneyRectangle()`，寬 74%、上緣 44% 起算高 20%）重跑一次，並放寬正則以容忍 `NT$` 被誤認成 `NTS` / `NT5`、全形逗號句號等常見誤讀。
- **忽略本機開發用的 log**（`ae5389a`，`.gitignore`）— 把 `dev*.log`、`node-error.log` 這類檔案從版控移除。
- **UberHelper web MVP 初版**（`f963978`）— 以 `site-creator-vinext-starter`（Next.js 16 + vinext + Cloudflare Worker）為底，做出上傳截圖 → 瀏覽器端 tesseract.js 辨識（eng + chi_tra）→ 顯示接單建議的單頁流程，包含可手動修正的欄位、OCR 原始文字檢視，以及 SSR 骨架的 node:test 驗證。
