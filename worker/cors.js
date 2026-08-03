/**
 * 只允許本機開發與自己的 GitHub Pages 來源。
 * 其他來源不會取得 Access-Control-Allow-Origin，瀏覽器即會擋下。
 */
const ALLOWED_ORIGINS = new Set([
  'http://127.0.0.1:5173',
  'http://127.0.0.1:5174',
  'http://localhost:5173',
  'https://s9726229-hash.github.io',
]);

/**
 * 依請求來源產生 CORS 標頭。
 *
 * 這些標頭刻意「不」寫進快取：快取內容是與來源無關的 FinMind 回應，
 * 若把某個來源的 Access-Control-Allow-Origin 一併快取，
 * 之後其他來源的請求會拿到錯誤的標頭。
 */
export function corsHeaders(request) {
  const origin = request.headers.get('Origin');

  if (!origin || !ALLOWED_ORIGINS.has(origin)) {
    return { Vary: 'Origin' };
  }

  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}
