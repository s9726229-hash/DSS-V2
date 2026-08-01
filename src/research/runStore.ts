import { openDssDatabase } from '../storage/database';
import type { ResearchRunRecord } from '../storage/types';
import type { ResearchReport } from './runResearch';
import { RESEARCH_METRICS } from './runResearch';

/**
 * 這次搜尋結果的內容簽章。
 *
 * 只納入規格要求保存的判定依據——樣本讀數、每個檢查點的門檻與事件數、
 * 每個候選區間的範圍、計數、證據等級與原因。刻意不含執行時間，
 * 否則每次重新整理頁面都會被當成新結果而重複寫入。
 */
export function researchRunSignature(report: ResearchReport): string {
  return JSON.stringify({
    entryCount: report.entryCount,
    technicalCount: report.technicalCount,
    chipCount: report.chipCount,
    completeCount: report.completeCount,
    results: RESEARCH_METRICS.map((metric) =>
      (['stock', 'etf'] as const).map((assetClass) => {
        const result = report.results[metric][assetClass];
        return {
          checkpoints: result.checkpoints,
          drift: result.drift,
          baseline: result.baseline,
          bands: result.bands.map((band) => ({
            band: band.band,
            range: band.range,
            completeCount: band.completeCount,
            nonOverlappingCount: band.nonOverlappingCount,
            flippedCount: band.flippedCount,
            stableCount: band.stableCount,
            cleanCount: band.cleanCount,
            median: band.median,
            stableMedian: band.stableMedian,
            nonOverlappingMedian: band.nonOverlappingMedian,
            mean: band.mean,
            worst: band.worst,
            positiveCount: band.positiveCount,
            negativeCount: band.negativeCount,
            checkpointsCovered: band.checkpointsCovered,
            evidence: band.evidence,
            reason: band.reason,
          })),
        };
      }),
    ),
  });
}

export type SaveResearchRunResult =
  | { saved: true; record: ResearchRunRecord }
  | { saved: false; reason: 'unchanged' | 'no-entries' };

/**
 * 保存一次候選搜尋。
 *
 * 兩種情況不寫入：
 * - 研究期間內沒有任何建立部位——沒有東西可搜尋，就不算一次搜尋。
 * - 與上一筆結果完全相同：重新整理頁面並不是一次新的搜尋，
 *   若照寫會讓紀錄被大量相同內容淹沒，反而看不出門檻真正變動的時點。
 *
 * 讀取與寫入刻意放在同一個 readwrite 交易內。React StrictMode 會在開發模式
 * 重複觸發 effect，分開的讀寫會讓兩次呼叫都認為「沒有上一筆」而各寫一筆。
 */
export async function saveResearchRun(
  report: ResearchReport,
  executedAt: string,
): Promise<SaveResearchRunResult> {
  if (report.entryCount === 0) {
    return { saved: false, reason: 'no-entries' };
  }

  const signature = researchRunSignature(report);
  const db = await openDssDatabase();

  try {
    const transaction = db.transaction('researchRuns', 'readwrite');
    const existing = await transaction.store.getAll();
    const latest = existing.reduce<ResearchRunRecord | null>(
      (newest, row) => (newest === null || row.executedAt > newest.executedAt ? row : newest),
      null,
    );

    if (latest !== null && latest.signature === signature) {
      await transaction.done;
      return { saved: false, reason: 'unchanged' };
    }

    const record: ResearchRunRecord = {
      id: `run:${executedAt}`,
      executedAt,
      signature,
      entryCount: report.entryCount,
      excludesReentries: true,
      technicalCount: report.technicalCount,
      chipCount: report.chipCount,
      completeCount: report.completeCount,
      results: report.results,
    };

    await transaction.store.put(record);
    await transaction.done;

    return { saved: true, record };
  } finally {
    db.close();
  }
}

/** 最新的搜尋排在最前面。 */
export async function readResearchRuns(): Promise<ResearchRunRecord[]> {
  const db = await openDssDatabase();

  try {
    const all = await db.getAll('researchRuns');
    return all.sort((a, b) => b.executedAt.localeCompare(a.executedAt));
  } finally {
    db.close();
  }
}
