import type { DBSchema } from 'idb';
import type { ImportedTransaction } from '../import/types';
import type { ResearchMetric } from '../research/runResearch';
import type { AssetClass } from '../research/snapshot';
import type { WalkForwardResult } from '../research/walkForward';

export type StoredTransaction = ImportedTransaction & {
  /** `${內容簽章}#${同簽章出現序號}`，見 transactionSignature 的說明。 */
  id: string;
  importedAt: string;
};

export type HoldingSnapshotRecord = {
  id: string;
  snapshotDate: string;
  stockId: string;
  stockName: string;
  tradeType: string;
  quantity: number;
  costPrice: number;
  currentPrice: number;
  importedAt: string;
};

export type StoredSetting = {
  key: string;
  value: unknown;
};

export type MarketCacheRecord = {
  id: string;
  dataset: string;
  stockId: string;
  tradeDate: string;
  retrievedAt: string;
  payload: unknown;
};

/**
 * 一次候選搜尋的完整結果。
 *
 * 規格要求保存訓練截止日、25／75 分位、三個候選區間、訓練／驗證事件數、
 * 完整／非重疊事件數、比較指標與合格／淘汰原因，且「不可只保存最後勝出值」——
 * 因此這裡整份收下 walk-forward 的輸出（含每個區間的 reason），
 * 而不是只留下勝出的門檻數字。
 */
export type ResearchRunRecord = {
  /** `run:${executedAt}`。 */
  id: string;
  executedAt: string;
  /** 結果內容簽章，用來判斷這次搜尋是否與上一次完全相同。 */
  signature: string;
  entryCount: number;
  /**
   * 這次搜尋是否已排除再進場。
   *
   * 2026-08-01 之前的紀錄把再進場一併算進建立部位，樣本定義與現在不同，
   * 缺這個欄位就代表是舊定義；兩者的筆數不可直接比較，所以必須標示而不是靜靜混列。
   */
  excludesReentries?: boolean;
  technicalCount: number;
  chipCount: number;
  completeCount: number;
  /** 三個研究指標 × 兩種資產類別的完整結果。 */
  results: Record<ResearchMetric, Record<AssetClass, WalkForwardResult>>;
};

export type BackupPayload = {
  version: 1;
  createdAt: string;
  settings: StoredSetting[];
  transactions: StoredTransaction[];
  holdingsSnapshots: HoldingSnapshotRecord[];
  researchRuns: ResearchRunRecord[];
  marketCache: MarketCacheRecord[];
};

/** 輕量備份不含市場快取，檔案小、便於日常保存。 */
export type LightweightBackupPayload = Omit<BackupPayload, 'marketCache'>;

export interface DssDatabase extends DBSchema {
  settings: {
    key: string;
    value: StoredSetting;
  };
  transactions: {
    key: string;
    value: StoredTransaction;
  };
  holdingsSnapshots: {
    key: string;
    value: HoldingSnapshotRecord;
  };
  marketCache: {
    key: string;
    value: MarketCacheRecord;
  };
  researchRuns: {
    key: string;
    value: ResearchRunRecord;
  };
}
