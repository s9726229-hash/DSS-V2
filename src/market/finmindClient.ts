import type { FetchFailureReason, FetchResult, FinMindDataset } from './types';

/**
 * Worker 位址。瀏覽器不持有也不傳送 FinMind token，
 * 因此查詢網址只會包含資料集、股號與日期。
 */
const WORKER_BASE_URL =
  import.meta.env.VITE_FINMIND_WORKER_URL ?? 'https://dss-v2-finmind.s9726229.workers.dev';

export type DateRange = {
  startDate: string;
  endDate: string;
};

export function buildDatasetUrl(
  dataset: FinMindDataset,
  stockId: string,
  { startDate, endDate }: DateRange,
): string {
  const url = new URL('/api/finmind/data', WORKER_BASE_URL);

  url.searchParams.set('dataset', dataset);
  url.searchParams.set('data_id', stockId);
  url.searchParams.set('start_date', startDate);
  url.searchParams.set('end_date', endDate);

  return url.toString();
}

const MESSAGES: Record<FetchFailureReason, string> = {
  'invalid-request': '查詢條件不合法，請確認股票代號與日期範圍。',
  'not-configured': 'Worker 尚未設定 FinMind 憑證。',
  'upstream-forbidden': 'FinMind 帳號權限不足，此資料集需要付費等級。',
  'upstream-rate-limited': 'FinMind 請求次數已達上限，請稍後再試。',
  'upstream-error': 'FinMind 服務暫時無法取得資料。',
  'network-error': '無法連線到資料服務。',
  'malformed-response': '資料服務回應的格式無法解析。',
};

function failure<TRow>(reason: FetchFailureReason): FetchResult<TRow> {
  return { ok: false, reason, message: MESSAGES[reason] };
}

/** 依上游狀態碼區分帳號權限不足、限流與其他錯誤。 */
function reasonForUpstreamStatus(upstreamStatus: unknown): FetchFailureReason {
  if (upstreamStatus === 400 || upstreamStatus === 401 || upstreamStatus === 403) {
    return 'upstream-forbidden';
  }
  if (upstreamStatus === 429) {
    return 'upstream-rate-limited';
  }
  return 'upstream-error';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * 取得單一資料集。任何失敗都以 FetchResult 回報，不拋出例外，
 * 讓呼叫端能對單一股票的失敗做局部處理而不中斷其他股票。
 */
export async function fetchDataset<TRow>(
  dataset: FinMindDataset,
  stockId: string,
  range: DateRange,
): Promise<FetchResult<TRow>> {
  let response: Response;

  try {
    response = await fetch(buildDatasetUrl(dataset, stockId, range));
  } catch {
    return failure('network-error');
  }

  let body: unknown;

  try {
    body = await response.json();
  } catch {
    return failure('malformed-response');
  }

  if (!response.ok) {
    if (response.status === 400) return failure('invalid-request');
    if (response.status === 503) return failure('not-configured');
    if (response.status === 502 && isRecord(body)) {
      return failure(reasonForUpstreamStatus(body.upstreamStatus));
    }
    return failure('upstream-error');
  }

  if (!isRecord(body) || !Array.isArray(body.data)) {
    return failure('malformed-response');
  }

  // FinMind 也可能在 HTTP 200 中以 status 欄位回報錯誤
  if (typeof body.status === 'number' && body.status !== 200) {
    return failure(reasonForUpstreamStatus(body.status));
  }

  return { ok: true, rows: body.data as TRow[] };
}
