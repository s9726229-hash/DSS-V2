import { openDssDatabase } from './database';
import type {
  BackupPayload,
  HoldingSnapshotRecord,
  LightweightBackupPayload,
  MarketCacheRecord,
  StoredSetting,
  StoredTransaction,
} from './types';

export const BACKUP_VERSION = 1;

/**
 * 憑證一律由 Worker 保管，前端不該持有；此處再做一道防線，
 * 確保任何疑似 token／密鑰的設定都不會寫進會離開本機的備份檔。
 */
const SENSITIVE_SETTING_KEY = /token|secret|password|apikey|api_key|credential/i;

function withoutSensitiveSettings(settings: StoredSetting[]): StoredSetting[] {
  return settings.filter((setting) => !SENSITIVE_SETTING_KEY.test(setting.key));
}

export async function createBackup(): Promise<BackupPayload> {
  const db = await openDssDatabase();

  try {
    const [settings, transactions, holdingsSnapshots, marketCache] = await Promise.all([
      db.getAll('settings'),
      db.getAll('transactions'),
      db.getAll('holdingsSnapshots'),
      db.getAll('marketCache'),
    ]);

    return {
      version: BACKUP_VERSION,
      createdAt: new Date().toISOString(),
      settings: withoutSensitiveSettings(settings),
      transactions,
      holdingsSnapshots,
      marketCache,
    };
  } finally {
    db.close();
  }
}

export async function createLightweightBackup(): Promise<LightweightBackupPayload> {
  const { marketCache: _marketCache, ...lightweight } = await createBackup();
  return lightweight;
}

export type RestoreResult = { ok: true; restored: { transactions: number; holdingsSnapshots: number } } | { ok: false; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 還原一律取代 settings／transactions／holdingsSnapshots。
 * marketCache 只在備份檔含有該欄位時才取代，
 * 這樣還原輕量備份不會清掉本機既有快取（快取可重新向 FinMind 取得，但重取有成本）。
 */
export async function restoreBackup(payload: unknown): Promise<RestoreResult> {
  if (!isRecord(payload)) {
    return { ok: false, error: '備份檔格式不正確：不是有效的 JSON 物件' };
  }

  if (payload.version !== BACKUP_VERSION) {
    return {
      ok: false,
      error: `備份檔版本不符：預期 ${BACKUP_VERSION}，實際為 ${String(payload.version)}`,
    };
  }

  const settings = payload.settings;
  const transactions = payload.transactions;
  const holdingsSnapshots = payload.holdingsSnapshots;
  const marketCache = payload.marketCache;

  if (
    !Array.isArray(settings) ||
    !Array.isArray(transactions) ||
    !Array.isArray(holdingsSnapshots) ||
    (marketCache !== undefined && !Array.isArray(marketCache))
  ) {
    return { ok: false, error: '備份檔格式不正確：資料欄位必須為陣列' };
  }

  const db = await openDssDatabase();

  try {
    const storeNames: ('settings' | 'transactions' | 'holdingsSnapshots' | 'marketCache')[] =
      marketCache === undefined
        ? ['settings', 'transactions', 'holdingsSnapshots']
        : ['settings', 'transactions', 'holdingsSnapshots', 'marketCache'];

    const transaction = db.transaction(storeNames, 'readwrite');

    await Promise.all([
      transaction.objectStore('settings').clear(),
      transaction.objectStore('transactions').clear(),
      transaction.objectStore('holdingsSnapshots').clear(),
      ...(marketCache === undefined ? [] : [transaction.objectStore('marketCache').clear()]),
    ]);

    await Promise.all([
      ...withoutSensitiveSettings(settings as StoredSetting[]).map((row) =>
        transaction.objectStore('settings').put(row),
      ),
      ...(transactions as StoredTransaction[]).map((row) =>
        transaction.objectStore('transactions').put(row),
      ),
      ...(holdingsSnapshots as HoldingSnapshotRecord[]).map((row) =>
        transaction.objectStore('holdingsSnapshots').put(row),
      ),
      ...(marketCache === undefined
        ? []
        : (marketCache as MarketCacheRecord[]).map((row) =>
            transaction.objectStore('marketCache').put(row),
          )),
    ]);

    await transaction.done;

    return {
      ok: true,
      restored: {
        transactions: transactions.length,
        holdingsSnapshots: holdingsSnapshots.length,
      },
    };
  } catch (error) {
    return {
      ok: false,
      error: `還原失敗：${error instanceof Error ? error.message : String(error)}`,
    };
  } finally {
    db.close();
  }
}
