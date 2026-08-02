/** Worker 允許的資料集。 */
export type FinMindDataset =
  | 'TaiwanStockPrice'
  | 'TaiwanStockPriceAdj'
  | 'TaiwanStockDividendResult'
  | 'TaiwanStockSplitPrice'
  | 'TaiwanStockInstitutionalInvestorsBuySell'
  | 'TaiwanStockInfo'
  | 'TaiwanStockMarginPurchaseShortSale';

export type PriceRow = {
  date: string;
  stock_id: string;
  open: number;
  max: number;
  min: number;
  close: number;
  Trading_Volume: number;
};

/**
 * 法人資料每個交易日會有多列，以 name 區分身分。
 * 規格要求外資與投信分開計算，且不可把外資自營商併入外資。
 */
export type InstitutionalRow = {
  date: string;
  stock_id: string;
  name: 'Foreign_Investor' | 'Foreign_Dealer_Self' | 'Investment_Trust' | 'Dealer_self' | string;
  buy: number;
  sell: number;
};

/**
 * 融資融券餘額。
 *
 * 單位是**張**，與法人資料的股差一千倍。混用不會有任何錯誤訊息，
 * 只會安靜地算出離譜的結果，因此進入共用計算前一律先換算成股。
 */
export type MarginRow = {
  date: string;
  stock_id: string;
  MarginPurchaseTodayBalance: number;
  MarginPurchaseYesterdayBalance: number;
};

/**
 * 個股基本資料。價格資料只有 stock_id，中文名稱只能從這裡取得。
 * 同一檔可能有多列（上市與興櫃等），因此取用時要比對 stock_id 而不是直接取第一列。
 */
export type StockInfoRow = {
  stock_id: string;
  stock_name: string;
};

/** 除權息與分割共用的結構：還原係數為 after_price / before_price。 */
export type AdjustmentEventRow = {
  date: string;
  stock_id: string;
  before_price: number;
  after_price: number;
};

export type FetchFailureReason =
  | 'invalid-request'
  | 'not-configured'
  | 'upstream-forbidden'
  | 'upstream-rate-limited'
  | 'upstream-error'
  | 'network-error'
  | 'malformed-response';

export type FetchResult<TRow> =
  | { ok: true; rows: TRow[] }
  | { ok: false; reason: FetchFailureReason; message: string };
