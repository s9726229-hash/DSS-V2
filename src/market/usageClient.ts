import { WORKER_BASE_URL } from './finmindClient';
import type { FetchFailureReason } from './types';

/**
 * FinMind 用量。
 *
 * 這支查詢本身算不算進額度未見於文件，因此呼叫端只在同步完成後
 * 與使用者手動刷新時呼叫，Worker 端另有 60 秒快取。
 */
export type UsageResult =
  | { ok: true; used: number; limit: number; remaining: number }
  | { ok: false; reason: FetchFailureReason };

export function buildUsageUrl(): string {
  return new URL('/api/finmind/usage', WORKER_BASE_URL).toString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export async function fetchFinMindUsage(): Promise<UsageResult> {
  let response: Response;

  try {
    response = await fetch(buildUsageUrl());
  } catch {
    return { ok: false, reason: 'network-error' };
  }

  let body: unknown;

  try {
    body = await response.json();
  } catch {
    return { ok: false, reason: 'malformed-response' };
  }

  if (!response.ok) {
    if (response.status === 503) return { ok: false, reason: 'not-configured' };
    return { ok: false, reason: 'upstream-error' };
  }

  if (!isRecord(body) || !Number.isFinite(body.used) || !Number.isFinite(body.limit)) {
    return { ok: false, reason: 'malformed-response' };
  }

  const used = body.used as number;
  const limit = body.limit as number;

  // 上限可能在額度已超用時仍回傳，剩餘量以零為下限，不顯示負數
  return { ok: true, used, limit, remaining: Math.max(0, limit - used) };
}
