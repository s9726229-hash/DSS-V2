import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchFinMindUsage } from './usageClient';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('FinMind 用量', () => {
  it('回傳已用次數、上限與剩餘量', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ used: 137, limit: 600 })));

    const result = await fetchFinMindUsage();

    expect(result).toEqual({ ok: true, used: 137, limit: 600, remaining: 463 });
  });

  it('查詢的是 Worker 的用量端點', async () => {
    const spy = vi.fn(async (input: RequestInfo | URL) => {
      void input;
      return jsonResponse({ used: 1, limit: 600 });
    });
    vi.stubGlobal('fetch', spy);

    await fetchFinMindUsage();

    expect(String(spy.mock.calls[0][0])).toContain('/api/finmind/usage');
  });

  it('用量超過上限時剩餘量以零為下限，不顯示負數', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ used: 610, limit: 600 })));

    const result = await fetchFinMindUsage();

    expect(result).toMatchObject({ ok: true, remaining: 0 });
  });

  it('連線失敗時回報而不拋出例外', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline');
      }),
    );

    const result = await fetchFinMindUsage();

    expect(result.ok).toBe(false);
  });

  it('Worker 尚未設定憑證時回報 not-configured', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ error: 'not configured', detail: 'blank' }, 503)),
    );

    const result = await fetchFinMindUsage();

    expect(result).toMatchObject({ ok: false, reason: 'not-configured' });
  });

  it('上游錯誤時回報而不假裝有數字', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ error: 'FinMind upstream error', upstreamStatus: 500 }, 502)),
    );

    const result = await fetchFinMindUsage();

    expect(result.ok).toBe(false);
  });

  it('回應缺少欄位或不是數字時視為格式錯誤', async () => {
    for (const body of [{ used: 1 }, { used: 'many', limit: 600 }, {}]) {
      vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(body)));

      const result = await fetchFinMindUsage();

      expect(result).toMatchObject({ ok: false, reason: 'malformed-response' });
    }
  });

  it('回應不是 JSON 時視為格式錯誤', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>', { status: 200 })));

    const result = await fetchFinMindUsage();

    expect(result).toMatchObject({ ok: false, reason: 'malformed-response' });
  });
});
