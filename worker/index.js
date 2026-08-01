import { corsHeaders } from './cors.js';
import { fetchFinMindData } from './finmind-gateway.js';
import { fetchFinMindUsage } from './finmind-usage.js';

const FINMIND_PATH = '/api/finmind/data';
const USAGE_PATH = '/api/finmind/usage';

/** 把來源相依的 CORS 標頭套到回應上；回應本體與來源無關，可安全快取。 */
function withCors(response, request) {
  const headers = new Headers(response.headers);

  for (const [key, value] of Object.entries(corsHeaders(request))) {
    headers.set(key, value);
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname !== FINMIND_PATH && url.pathname !== USAGE_PATH) {
      return withCors(Response.json({ error: 'Not found' }, { status: 404 }), request);
    }

    if (request.method === 'OPTIONS') {
      return withCors(new Response(null, { status: 204 }), request);
    }

    if (request.method !== 'GET') {
      return withCors(Response.json({ error: 'Method not allowed' }, { status: 405 }), request);
    }

    const handler = url.pathname === USAGE_PATH ? fetchFinMindUsage : fetchFinMindData;

    return withCors(await handler(request, env, ctx), request);
  },
};
