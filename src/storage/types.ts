import type { DBSchema } from 'idb';
import type { ImportedTransaction } from '../import/types';

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

export type BackupPayload = {
  version: 1;
  createdAt: string;
  settings: StoredSetting[];
  transactions: StoredTransaction[];
  holdingsSnapshots: HoldingSnapshotRecord[];
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
}
