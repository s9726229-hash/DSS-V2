export type TransactionSide = 'buy' | 'sell';

export type ImportedTransaction = {
  tradeDate: string;
  stockId: string;
  stockName: string;
  side: TransactionSide;
  /** 交易種類：普通／定期定額。舊版已儲存資料可能缺少。 */
  tradeMethod?: string | null;
  /** 交易類別：現股／融資／融券。v1 不做融資分析，但保留供日後建立部位辨識使用。 */
  tradeType: string;
  quantity: number;
  price: number;
  fees: number;
  tax: number;
  settlementDate: string | null;
  brokerReference: string | null;
};

export type ImportedHolding = {
  stockId: string;
  stockName: string;
  tradeType: string;
  quantity: number;
  costPrice: number;
  currentPrice: number;
};

export type SkippedRow = {
  /** CSV 檔案中的實際行號（1-based，含標題列）。 */
  line: number;
  reason: string;
};

/**
 * 標題列缺少必要欄位時整份拒絕（ok: false）；
 * 個別資料列有問題則列入 skipped，不影響其他列。
 */
export type CsvParseResult<TRow> =
  | { ok: true; rows: TRow[]; skipped: SkippedRow[] }
  | { ok: false; error: string; missingColumns: string[] };
