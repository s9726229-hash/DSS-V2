import type { InstitutionalRow, PriceRow } from '../market/types';

/** 規格要求：主要觀察最近 5 個交易日。 */
export const CHIP_WINDOW_DAYS = 5;

/**
 * FinMind 的法人身分代碼。
 *
 * 規格明訂使用官方的「外資及陸資（不含外資自營商）」與「投信」，
 * 因此 Foreign_Dealer_Self 不可併入外資，Dealer_self 也不屬於任何一方。
 */
const FOREIGN_INVESTOR = 'Foreign_Investor';
const INVESTMENT_TRUST = 'Investment_Trust';

export type ChipDirection = 'buy' | 'sell' | 'flat';

export type Continuity = {
  direction: ChipDirection;
  /** 由最後一日往前推，同方向的連續天數。 */
  days: number;
};

export type InvestorChip = {
  /** 5 日淨買賣超合計（股）。 */
  fiveDayNet: number;
  /** 同期間 5 日平均成交量（股）。 */
  averageVolume: number;
  /** fiveDayNet / averageVolume，便於不同個股比較。 */
  strength: number;
  continuity: Continuity;
};

/**
 * 外資與投信的聯合狀態，僅供顯示。
 * 不得據此形成總分，也不得覆寫技術面結果。
 */
export type JointChipState =
  | 'both-accumulating'
  | 'both-distributing'
  | 'divergent'
  | 'no-consensus';

export type ChipSnapshot = {
  lastDate: string;
  foreign: InvestorChip;
  trust: InvestorChip;
  joint: JointChipState;
};

export type ChipResult =
  | { ok: true; snapshot: ChipSnapshot }
  | {
      ok: false;
      reason: 'insufficient-institutional-data';
      /** 最後一個有法人資料的日期，供畫面顯示「資料未就緒，最後可用日期為…」。 */
      lastAvailableDate: string | null;
    };

type DailyNet = { date: string; net: number };

function dailyNetFor(rows: readonly InstitutionalRow[], name: string): DailyNet[] {
  const byDate = new Map<string, number>();

  for (const row of rows) {
    if (row.name !== name) continue;
    byDate.set(row.date, (byDate.get(row.date) ?? 0) + (row.buy - row.sell));
  }

  return [...byDate.entries()]
    .map(([date, net]) => ({ date, net }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function directionOf(net: number): ChipDirection {
  if (net > 0) return 'buy';
  if (net < 0) return 'sell';
  return 'flat';
}

/** 由最後一日往前推算同方向的連續天數；最後一日持平時為 0 天。 */
function continuityOf(window: DailyNet[]): Continuity {
  const direction = directionOf(window[window.length - 1].net);

  if (direction === 'flat') {
    return { direction, days: 0 };
  }

  let days = 0;
  for (let index = window.length - 1; index >= 0; index -= 1) {
    if (directionOf(window[index].net) !== direction) break;
    days += 1;
  }

  return { direction, days };
}

function summarize(window: DailyNet[], volumeByDate: Map<string, number>): InvestorChip {
  const fiveDayNet = window.reduce((sum, day) => sum + day.net, 0);
  const averageVolume =
    window.reduce((sum, day) => sum + (volumeByDate.get(day.date) as number), 0) / window.length;

  return {
    fiveDayNet,
    averageVolume,
    strength: averageVolume === 0 ? 0 : fiveDayNet / averageVolume,
    continuity: continuityOf(window),
  };
}

function jointStateOf(foreignNet: number, trustNet: number): JointChipState {
  const foreign = directionOf(foreignNet);
  const trust = directionOf(trustNet);

  if (foreign === 'flat' || trust === 'flat') return 'no-consensus';
  if (foreign === trust) {
    return foreign === 'buy' ? 'both-accumulating' : 'both-distributing';
  }
  return 'divergent';
}

export function computeChipSnapshot({
  institutional,
  prices,
}: {
  institutional: readonly InstitutionalRow[];
  prices: readonly PriceRow[];
}): ChipResult {
  const volumeByDate = new Map(prices.map((row) => [row.date, row.Trading_Volume]));

  const foreignDaily = dailyNetFor(institutional, FOREIGN_INVESTOR);
  const trustDaily = dailyNetFor(institutional, INVESTMENT_TRUST);

  // 只採用能對應到成交量的交易日，避免用不同期間的量做正規化
  const usable = (daily: DailyNet[]): DailyNet[] =>
    daily.filter((day) => volumeByDate.has(day.date)).slice(-CHIP_WINDOW_DAYS);

  const foreignWindow = usable(foreignDaily);
  const trustWindow = usable(trustDaily);

  if (foreignWindow.length < CHIP_WINDOW_DAYS || trustWindow.length < CHIP_WINDOW_DAYS) {
    const seen = [...foreignDaily, ...trustDaily].map((day) => day.date).sort();

    return {
      ok: false,
      reason: 'insufficient-institutional-data',
      lastAvailableDate: seen.length === 0 ? null : seen[seen.length - 1],
    };
  }

  const foreign = summarize(foreignWindow, volumeByDate);
  const trust = summarize(trustWindow, volumeByDate);

  return {
    ok: true,
    snapshot: {
      lastDate: foreignWindow[foreignWindow.length - 1].date,
      foreign,
      trust,
      joint: jointStateOf(foreign.fiveDayNet, trust.fiveDayNet),
    },
  };
}
