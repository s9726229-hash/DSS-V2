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

function countBySignature(rows: readonly { signature: string }[]): Map<string, number> {
  const counts = new Map<string, number>();

  for (const { signature } of rows) {
    counts.set(signature, (counts.get(signature) ?? 0) + 1);
  }

  return counts;
}

type ImportPlan = {
  /** 每個簽章要新增的列，以及該簽章在資料庫既有的筆數（決定序號起點）。 */
  additions: { row: ImportedTransaction; signature: string; startOrdinal: number; count: number }[];
  newCount: number;
  duplicateCount: number;
};

function buildImportPlan(
  incoming: readonly ImportedTransaction[],
  existingCounts: Map<string, number>,
): ImportPlan {
  const incomingCounts = countBySignature(
    incoming.map((row) => ({ signature: transactionSignature(row) })),
  );
  const firstRowBySignature = new Map<string, ImportedTransaction>();

  for (const row of incoming) {
    const signature = transactionSignature(row);
    if (!firstRowBySignature.has(signature)) {
      firstRowBySignature.set(signature, row);
    }
  }

  const additions: ImportPlan['additions'] = [];
  let newCount = 0;

  for (const [signature, incomingCount] of incomingCounts) {
    const existing = existingCounts.get(signature) ?? 0;
    const count = Math.max(0, incomingCount - existing);

    if (count > 0) {
      additions.push({
        row: firstRowBySignature.get(signature) as ImportedTransaction,
        signature,
        startOrdinal: existing,
        count,
      });
      newCount += count;
    }
  }

  return { additions, newCount, duplicateCount: incoming.length - newCount };
}

async function readExistingCounts(): Promise<Map<string, number>> {
  const db = await openDssDatabase();

  try {
    const stored = await db.getAll('transactions');
    return countBySignature(stored.map((row) => ({ signature: transactionSignature(row) })));
  } finally {
    db.close();
  }
}

export type TransactionImportPreview = {
  newCount: number;
  duplicateCount: number;
};

/** 匯入預覽：只計算會新增與會略過的筆數，不寫入資料庫。 */
export async function planTransactionImport(
  rows: readonly ImportedTransaction[],
): Promise<TransactionImportPreview> {
  const { newCount, duplicateCount } = buildImportPlan(rows, await readExistingCounts());
  return { newCount, duplicateCount };
}

export type TransactionImportResult = {
  inserted: number;
  duplicateCount: number;
};

export async function importTransactions(
  rows: readonly ImportedTransaction[],
  importedAt: string,
): Promise<TransactionImportResult> {
  const db = await openDssDatabase();

  try {
    const stored = await db.getAll('transactions');
    const existingCounts = countBySignature(
      stored.map((row) => ({ signature: transactionSignature(row) })),
    );
    const plan = buildImportPlan(rows, existingCounts);

    const transaction = db.transaction('transactions', 'readwrite');
    const writes: Promise<unknown>[] = [];

    for (const addition of plan.additions) {
      for (let offset = 0; offset < addition.count; offset += 1) {
        writes.push(
          transaction.store.put({
            ...addition.row,
            id: `${addition.signature}#${addition.startOrdinal + offset}`,
            importedAt,
          } satisfies StoredTransaction),
        );
      }
    }

    await Promise.all(writes);
    await transaction.done;

    return { inserted: plan.newCount, duplicateCount: plan.duplicateCount };
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
