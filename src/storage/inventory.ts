import { openDssDatabase } from './database';

export type Inventory = {
  transactions: {
    count: number;
    firstDate: string | null;
    lastDate: string | null;
  };
  holdings: {
    count: number;
    snapshotDate: string | null;
  };
  marketCache: {
    count: number;
    lastRetrievedAt: string | null;
  };
};

function minMax(values: string[]): [string, string] | [null, null] {
  if (values.length === 0) {
    return [null, null];
  }

  return values.reduce<[string, string]>(
    ([min, max], value) => [value < min ? value : min, value > max ? value : max],
    [values[0], values[0]],
  );
}

/**
 * 本機實際存有多少資料。空的項目回報為 null 而非 0 值假象，
 * 讓畫面能明確顯示「未就緒」而不是把缺資料當成正常狀態。
 */
export async function readInventory(): Promise<Inventory> {
  const db = await openDssDatabase();

  try {
    const [transactions, holdings, marketCache] = await Promise.all([
      db.getAll('transactions'),
      db.getAll('holdingsSnapshots'),
      db.getAll('marketCache'),
    ]);

    const [firstDate, lastDate] = minMax(transactions.map((row) => row.tradeDate));

    const latestSnapshotDate =
      holdings.length === 0
        ? null
        : holdings.reduce(
            (latest, row) => (row.snapshotDate > latest ? row.snapshotDate : latest),
            holdings[0].snapshotDate,
          );

    const [, lastRetrievedAt] = minMax(marketCache.map((row) => row.retrievedAt));

    return {
      transactions: { count: transactions.length, firstDate, lastDate },
      holdings: {
        count: holdings.filter((row) => row.snapshotDate === latestSnapshotDate).length,
        snapshotDate: latestSnapshotDate,
      },
      marketCache: { count: marketCache.length, lastRetrievedAt },
    };
  } finally {
    db.close();
  }
}
