/**
 * FinMind 資料閘道。
 *
 * 瀏覽器不持有、也不傳送 FinMind token；token 只存在 Worker 的 Secret，
 * 由此處以 Authorization 標頭加到上游請求。
 */

/**
 * 資料集白名單，值為允許的日期區間上限（日曆天）。
 *
 * TaiwanStockPriceAdj 需要 FinMind 付費贊助等級，免費帳號會被上游拒絕；
 * 保留在白名單中，日後升級帳號即可直接使用。
 * 免費帳號改以 TaiwanStockPrice 搭配除息與分割事件自行還原。
 */
const ALLOWED_DATASETS = new Map([
  ['TaiwanStockPrice', 400],
  ['TaiwanStockPriceAdj', 400],
  ['TaiwanStockDividendResult', 400],
  ['TaiwanStockSplitPrice', 400],
  ['TaiwanStockInstitutionalInvestorsBuySell', 45],
]);

const REQUIRED_PARAMS = ['dataset', 'data_id', 'start_date', 'end_date'];
const STOCK_ID_PATTERN = /^[0-9A-Z]{4,6}$/;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const FINMIND_ENDPOINT = 'https://api.finmindtrade.com/api/v4/data';
const CACHE_TTL_SECONDS = 4 * 60 * 60;
const DAY_MS = 24 * 60 * 60 * 1000;

function parseDate(value) {
  const match = DATE_PATTERN.exec(value);
  if (!match) return null;

  const [, year, month, day] = match;
  const time = Date.UTC(Number(year), Number(month) - 1, Number(day));
  const date = new Date(time);

  // 攔截 2026-02-30 這類會被自動進位的日期
  if (date.getUTCMonth() !== Number(month) - 1 || date.getUTCDate() !== Number(day)) {
    return null;
  }

  return time;
}

function validateQuery(searchParams) {
  const keys = [...searchParams.keys()];

  if (keys.length !== REQUIRED_PARAMS.length) {
    return { error: 'invalid or duplicate parameters' };
  }

  for (const key of REQUIRED_PARAMS) {
    if (keys.filter((candidate) => candidate === key).length !== 1) {
      return { error: 'invalid or duplicate parameters' };
    }
  }

  const dataset = searchParams.get('dataset');
  const maxRangeDays = ALLOWED_DATASETS.get(dataset);
  if (!maxRangeDays) return { error: 'unknown dataset' };

  const dataId = searchParams.get('data_id');
  if (!STOCK_ID_PATTERN.test(dataId)) return { error: 'invalid stock id' };

  const startDate = searchParams.get('start_date');
  const endDate = searchParams.get('end_date');
  const startTime = parseDate(startDate);
  const endTime = parseDate(endDate);

  if (startTime === null || endTime === null) return { error: 'invalid date' };
  if (startTime > endTime) return { error: 'start date after end date' };
  if ((endTime - startTime) / DAY_MS > maxRangeDays) return { error: 'date range too large' };

  return { dataset, dataId, startDate, endDate };
}

/**
 * 上游失敗一律回 502 與固定訊息，不轉述上游文字，避免洩漏 token 或內部網址。
 * 只附上數字狀態碼，讓前端能分辨「權限不足」（400）與「限流」（429）。
 */
function upstreamError(upstreamStatus) {
  return Response.json({ error: 'FinMind upstream error', upstreamStatus }, { status: 502 });
}

/** 取出 FinMind 回應本體宣告的 status；無法解析時回傳 null。 */
function declaredUpstreamStatus(body) {
  try {
    const parsed = JSON.parse(body);
    return typeof parsed?.status === 'number' ? parsed.status : null;
  } catch {
    return null;
  }
}

/**
 * 回傳與來源無關的資料回應（不含 CORS 標頭），由呼叫端負責補上。
 */
export async function fetchFinMindData(request, env, ctx) {
  const url = new URL(request.url);
  const validated = validateQuery(url.searchParams);

  if ('error' in validated) {
    return Response.json({ error: validated.error }, { status: 400 });
  }

  const token = env.FINMIND_TOKEN;
  if (!token) {
    return Response.json({ error: 'FinMind service is not configured' }, { status: 503 });
  }

  const { dataset, dataId, startDate, endDate } = validated;

  // cache key 只由已驗證的參數組成
  const cacheKey = new Request(
    `https://finmind-gateway.cache/${dataset}/${dataId}/${startDate}/${endDate}`,
  );
  const cache = caches.default;
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  const upstreamUrl = new URL(FINMIND_ENDPOINT);
  upstreamUrl.searchParams.set('dataset', dataset);
  upstreamUrl.searchParams.set('data_id', dataId);
  upstreamUrl.searchParams.set('start_date', startDate);
  upstreamUrl.searchParams.set('end_date', endDate);

  let upstream;
  try {
    upstream = await fetch(upstreamUrl.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    return Response.json({ error: 'FinMind upstream error' }, { status: 502 });
  }

  if (!upstream.ok) {
    return upstreamError(upstream.status);
  }

  const body = await upstream.text();

  /*
   * FinMind 對部分錯誤（例如帳號等級不足）會以 HTTP 200 夾帶
   * `{"msg": "...", "status": 400}` 回應。若只看 HTTP 狀態，
   * 錯誤內容會被當成正常資料送進前端與快取。
   */
  const declaredStatus = declaredUpstreamStatus(body);
  if (declaredStatus !== null && declaredStatus !== 200) {
    return upstreamError(declaredStatus);
  }

  const response = new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': `public, max-age=${CACHE_TTL_SECONDS}`,
    },
  });

  ctx.waitUntil(cache.put(cacheKey, response.clone()));

  return response;
}
