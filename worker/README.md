# FinMind 資料閘道 Worker

DSS V2 專用的 Cloudflare Worker，與 FinTrack AI／DSSLab 共用的 TWSE Worker
（`gentle-voice-bcca`）分開部署，避免影響那些專案既有的 `/api/realtime` 與 TWSE 路徑。

## 為什麼需要它

瀏覽器直接以 `Authorization: Bearer` 呼叫 FinMind 會因 CORS 預檢失敗，
而且 token 會暴露在前端。這個 Worker 讓瀏覽器完全不持有也不傳送 token。

## 介面

```
GET /api/finmind/data?dataset=<資料集>&data_id=<股號>&start_date=<起>&end_date=<迄>
```

| 資料集 | 日期區間上限 |
| --- | --- |
| `TaiwanStockPriceAdj` | 400 個日曆日 |
| `TaiwanStockInstitutionalInvestorsBuySell` | 45 個日曆日 |

- `data_id`：4–6 位大寫英數字（`0050`、`00631L`、`00981A`）
- 日期須為合法 `YYYY-MM-DD`，起始日不得晚於結束日

### 回應

| 狀態 | 情境 |
| --- | --- |
| 200 | 成功，直接回傳 FinMind 的 JSON |
| 400 | 資料集、股號、日期格式或區間不合法 |
| 404 / 405 | 路徑或方法不符 |
| 503 | 未設定 `FINMIND_TOKEN` |
| 502 | 上游失敗，附 `upstreamStatus` 供前端分辨權限不足（400）與限流（429） |

### CORS

僅允許 `http://127.0.0.1:5173`、`http://127.0.0.1:5174`、`http://localhost:5173`、
`https://s9726229-hash.github.io`。其他來源不會取得
`Access-Control-Allow-Origin`。沒有 `Origin` 的請求（例如 curl）仍可取得資料。

CORS 標頭不進快取，每次依請求來源另外附加，避免跨來源共用標頭。

## 測試

```bash
node --test worker/finmind-gateway.test.mjs
```

## 部署

**尚未部署。** 部署與設定 Secret 都需要使用者明確同意。

```bash
wrangler secret put FINMIND_TOKEN
wrangler deploy
```

## 已知限制

`TaiwanStockPriceAdj`（還原權息價）需要 FinMind 付費贊助等級；
免費帳號呼叫會得到 HTTP 400 與「Your level is free」訊息，
本 Worker 會轉為 502 並附 `upstreamStatus: 400`。
法人資料集則免費可用。
