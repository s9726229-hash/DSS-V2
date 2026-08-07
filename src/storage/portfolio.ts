import type { ImportedHolding, ImportedTransaction } from '../import/types';
import { openDssDatabase } from './database';
import type { HoldingSnapshotRecord, StoredTransaction } from './types';

/**
 * 交易的內容簽章。
 *
 * 刻意「不」納入委託書號，有兩個實際資料上的理由：
 *
 * 1. 委託書號會被不同交易循環重複使用（同一組號碼可能同時出現在相隔數個月、
 *    不同股票的買進與賣出），拿它當唯一鍵會靜默刪掉真實交易。
 * 2. 同一筆交易在不同匯出檔的委託書號長度不一致（完整歷史檔為完整號碼，
 *    月份明細檔會截斷成較短的前綴），納入簽章會導致同一筆交易被重覆匯入。
 *
 * 反之也不能只靠內容比對就視為同一筆：一筆委託可能分次成交，
 * 產生日期、股票、數量、價格完全相同的多列，這些都是各自獨立的真實交易。
 *
 * 因此改以「簽章 + 出現次數」判定：比較同簽章在檔案與資料庫各有幾筆，只補進差額。
 */
export function transactionSignature(row: ImportedTransaction): string {
  return [
    row.tradeDate,
    row.stockId,
    row.side,
    row.tradeType,
    row.quantity,
    row.price,
    row.fees,
    row.tax,
    row.settlementDate ?? '',
  ].join('|');
}

type ImportPlan = {
  additions: { row: ImportedTransaction; signature: string; ordinal: number }[];
  enrichments: { stored: StoredTransaction; tradeMethod: string }[];
  newCount: number;
  enrichedCount: number;
  duplicateCount: number;
};

function buildImportPlan(
  incoming: readonly ImportedTransaction[],
  stored: readonly StoredTransaction[],
): ImportPlan {
  const incomingBySignature = new Map<string, ImportedTransaction[]>();
  const storedBySignature = new Map<string, StoredTransaction[]>();

  for (const row of incoming) {
    const signature = transactionSignature(row);
    const rows = incomingBySignature.get(signature) ?? [];
    rows.push(row);
    incomingBySignature.set(signature, rows);
  }

  for (const row of stored) {
    const signature = transactionSignature(row);
    const rows = storedBySignature.get(signature) ?? [];
    rows.push(row);
    storedBySignature.set(signature, rows);
  }

  const additions: ImportPlan['additions'] = [];
  const enrichments: ImportPlan['enrichments'] = [];

  for (const [signature, incomingRows] of incomingBySignature) {
    const storedRows = storedBySignature.get(signature) ?? [];
    const matched = Math.min(incomingRows.length, storedRows.length);

    for (let ordinal = 0; ordinal < matched; ordinal += 1) {
      const tradeMethod = incomingRows[ordinal].tradeMethod?.trim();
      if ((storedRows[ordinal].tradeMethod ?? null) === null && tradeMethod) {
        enrichments.push({ stored: storedRows[ordinal], tradeMethod });
      }
    }

    for (let ordinal = storedRows.length; ordinal < incomingRows.length; ordinal += 1) {
      additions.push({ row: incomingRows[ordinal], signature, ordinal });
    }
  }

  return {
    additions,
    enrichments,
    newCount: additions.length,
    enrichedCount: enrichments.length,
    duplicateCount: incoming.length - additions.length,
  };
}

export type TransactionImportPreview = {
  newCount: number;
  enrichedCount: number;
  duplicateCount: number;
};

/** 匯入預覽：只計算會新增與會略過的筆數，不寫入資料庫。 */
export async function planTransactionImport(
  rows: readonly ImportedTransaction[],
): Promise<TransactionImportPreview> {
  const db = await openDssDatabase();

  try {
    const { newCount, enrichedCount, duplicateCount } = buildImportPlan(
      rows,
      await db.getAll('transactions'),
    );
    return { newCount, enrichedCount, duplicateCount };
  } finally {
    db.close();
  }
}

export type TransactionImportResult = {
  inserted: number;
  enriched: number;
  duplicateCount: number;
};

export async function importTransactions(
  rows: readonly ImportedTransaction[],
  importedAt: string,
): Promise<TransactionImportResult> {
  const db = await openDssDatabase();

  try {
    const stored = await db.getAll('transactions');
    const plan = buildImportPlan(rows, stored);

    const transaction = db.transaction('transactions', 'readwrite');
    const writes: Promise<unknown>[] = [];

    for (const addition of plan.additions) {
      writes.push(
        transaction.store.put({
          ...addition.row,
          id: `${addition.signature}#${addition.ordinal}`,
          importedAt,
        } satisfies StoredTransaction),
      );
    }

    for (const enrichment of plan.enrichments) {
      writes.push(
        transaction.store.put({
          ...enrichment.stored,
          tradeMethod: enrichment.tradeMethod,
        }),
      );
    }

    await Promise.all(writes);
    await transaction.done;

    return {
      inserted: plan.newCount,
      enriched: plan.enrichedCount,
      duplicateCount: plan.duplicateCount,
    };
  } finally {
    db.close();
  }
}

export async function readTransactions(): Promise<StoredTransaction[]> {
  const db = await openDssDatabase();

  try {
    return await db.getAll('transactions');
  } finally {
    db.close();
  }
}

/** 同一天再次匯入庫存會整份取代該日快照，避免殘留已賣出的個股。 */
export async function importHoldingsSnapshot(
  rows: readonly ImportedHolding[],
  snapshotDate: string,
  importedAt: string,
): Promise<void> {
  const db = await openDssDatabase();

  try {
    const transaction = db.transaction('holdingsSnapshots', 'readwrite');
    const existing = await transaction.store.getAll();

    await Promise.all([
      ...existing
        .filter((row) => row.snapshotDate === snapshotDate)
        .map((row) => transaction.store.delete(row.id)),
      ...rows.map((row) =>
        transaction.store.put({
          id: `holdings:${snapshotDate}:${row.stockId}`,
          snapshotDate,
          stockId: row.stockId,
          stockName: row.stockName,
          tradeType: row.tradeType,
          quantity: row.quantity,
          costPrice: row.costPrice,
          currentPrice: row.currentPrice,
          importedAt,
        } satisfies HoldingSnapshotRecord),
      ),
    ]);
    await transaction.done;
  } finally {
    db.close();
  }
}

/** 未指定日期時回傳最新一份快照；沒有任何快照時回傳空陣列。 */
export async function readHoldingsSnapshot(
  snapshotDate?: string,
): Promise<HoldingSnapshotRecord[]> {
  const db = await openDssDatabase();

  try {
    const all = await db.getAll('holdingsSnapshots');

    if (all.length === 0) {
      return [];
    }

    const targetDate =
      snapshotDate ?? all.reduce((latest, row) => (row.snapshotDate > latest ? row.snapshotDate : latest), all[0].snapshotDate);

    return all.filter((row) => row.snapshotDate === targetDate);
  } finally {
    db.close();
  }
}
