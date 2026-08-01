/**
 * FinMind 用量查詢。
 *
 * 端點與資料 API 不同：主機是 api.web.finmindtrade.com、版本是 /v2，
 * 回傳 user_count（已用）與 api_request_limit（上限，免費帳號為每小時 600）。
 *
 * 這支查詢本身是否計入額度並未見於文件，也不宜拿使用者的額度去試，
 * 因此一律短期快取，前端也只在同步完成後與手動刷新時才呼叫。
 */

const USER_INFO_ENDPOINT = 'https://api.web.finmindtrade.com/v2/user_info';
const CACHE_TTL_SECONDS = 60;
const CACHE_KEY = 'https://finmind-gateway.cache/usage';

function upstreamError(upstreamStatus) {
  return Response.json({ error: 'FinMind upstream error', upstreamStatus }, { status: 502 });
}

/** 回應必須是兩個真數字，缺欄位或型別不符一律當上游錯誤，不讓 null 或 NaN 流到前端。 */
function readUsage(body) {
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }

  if (typeof parsed?.status === 'number' && parsed.status !== 200) {
    return { declaredStatus: parsed.status };
  }

  const used = parsed?.user_count;
  const limit = parsed?.api_request_limit;

  if (!Number.isFinite(used) || !Number.isFinite(limit)) return null;

  return { used, limit };
}

export async function fetchFinMindUsage(request, env, ctx) {
  const url = new URL(request.url);

  // 這支端點不接受任何參數；有參數代表呼叫端誤用，直接擋下
  if ([...url.searchParams.keys()].length > 0) {
    return Response.json({ error: 'unexpected parameters' }, { status: 400 });
  }

  // 與資料閘道相同：區分 Secret 未設定與存入空字串，兩者成因完全不同
  const token = typeof env.FINMIND_TOKEN === 'string' ? env.FINMIND_TOKEN.trim() : '';
  if (!token) {
    return Response.json(
      {
        error: 'FinMind service is not configured',
        detail: env.FINMIND_TOKEN === undefined ? 'missing' : 'blank',
      },
      { status: 503 },
    );
  }

  const cacheKey = new Request(CACHE_KEY);
  const cache = caches.default;
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  let upstream;
  try {
    upstream = await fetch(USER_INFO_ENDPOINT, {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    return Response.json({ error: 'FinMind upstream error' }, { status: 502 });
  }

  if (!upstream.ok) {
    return upstreamError(upstream.status);
  }

  const usage = readUsage(await upstream.text());

  if (usage === null) {
    return upstreamError(upstream.status);
  }

  if ('declaredStatus' in usage) {
    return upstreamError(usage.declaredStatus);
  }

  /*
   * 只回兩個數字。上游本體其餘欄位一律不轉述，
   * 與資料閘道同一條規矩，避免夾帶 token 或內部訊息。
   */
  const response = new Response(JSON.stringify({ used: usage.used, limit: usage.limit }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': `public, max-age=${CACHE_TTL_SECONDS}`,
    },
  });

  ctx.waitUntil(cache.put(cacheKey, response.clone()));

  return response;
}
