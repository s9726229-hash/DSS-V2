import { describe, expect, it } from 'vitest';
import { computeFlow, DEFAULT_FLOW_THRESHOLDS, type FlowThresholds } from './flow';

const LOT = 1000;

/** 由舊到新的每日淨額（張），最後一筆是今日。 */
function series(...lots: number[]) {
  return lots.map((value, index) => ({
    date: `2026-07-${String(index + 10).padStart(2, '0')}`,
    net: value * LOT,
  }));
}

/** 前五日固定為 baseline，第六筆是今日。 */
function fiveThen(baseline: number, today: number) {
  return series(baseline, baseline, baseline, baseline, baseline, today);
}

describe('資料不足', () => {
  /*
   * 基準要五個交易日，加上今日就是六筆。少一筆就不猜——
   * 拿三天當「近期平均」跟拿五天是兩件事，畫面不該分不出來。
   */
  it('少於六個交易日時不給結果', () => {
    expect(computeFlow(series(1, 1, 1, 1, 1))).toBeNull();
    expect(computeFlow([])).toBeNull();
  });

  it('剛好六個交易日就算得出來', () => {
    expect(computeFlow(fiveThen(7_000, 10_000))).not.toBeNull();
  });

  it('超過六筆時只取最近六筆，較舊的不影響基準', () => {
    const noisy = computeFlow(series(999, -999, 7_000, 7_000, 7_000, 7_000, 7_000, 10_000));
    const clean = computeFlow(fiveThen(7_000, 10_000));

    expect(noisy?.baseline).toBe(clean?.baseline);
    expect(noisy?.ratio).toBe(clean?.ratio);
  });
});

describe('基準只看前五日，不含今日', () => {
  /*
   * 今日若算進基準，等於自己墊高自己的比較對象，
   * 放量或爆量那天的變化會被自己稀釋掉。
   */
  it('今日的數值不進入平均', () => {
    const result = computeFlow(fiveThen(7_000, 100_000));

    expect(result?.baseline).toBe(7_000 * LOT);
    expect(result?.today).toBe(100_000 * LOT);
  });
});

describe('同方向時比較力道', () => {
  it('買超變大是買超增加', () => {
    const result = computeFlow(fiveThen(7_000, 10_000));

    expect(result?.change).toBe('buy-up');
    expect(result?.ratio).toBeCloseTo(1.43, 2);
    expect(result?.strength).toBe('stronger');
  });

  it('買超變小是買超減少', () => {
    const result = computeFlow(fiveThen(7_000, 3_000));

    expect(result?.change).toBe('buy-down');
    expect(result?.strength).toBe('weaker');
  });

  /* 賣超比的是絕對值：-10000 比 -7000「更賣」，不是「比較小」。 */
  it('賣超絕對值變大是賣超增加', () => {
    const result = computeFlow(fiveThen(-7_000, -10_000));

    expect(result?.change).toBe('sell-up');
    expect(result?.ratio).toBeCloseTo(1.43, 2);
  });

  it('賣超絕對值變小是賣超減少', () => {
    const result = computeFlow(fiveThen(-7_000, -3_000));

    expect(result?.change).toBe('sell-down');
  });

  /*
   * 規格第四節只寫增加與減少，第六節卻列了「持平」。
   * 用第五節的 0.8–1.2 當持平帶，三者才自洽。
   */
  it('力道與近期相當時是持平', () => {
    expect(computeFlow(fiveThen(10_000, 9_000))?.change).toBe('buy-flat');
    expect(computeFlow(fiveThen(-10_000, -11_000))?.change).toBe('sell-flat');
  });
});

describe('方向反轉', () => {
  /*
   * 直接相除會得到負的比例，看不出「買轉賣」。
   * 因此一律先判方向、再比力道。
   */
  it('前五日買超、今日賣超是買轉賣', () => {
    const result = computeFlow(fiveThen(7_000, -5_000));

    expect(result?.change).toBe('buy-to-sell');
    expect(result?.todayDirection).toBe('sell');
    expect(result?.baselineDirection).toBe('buy');
  });

  it('前五日賣超、今日買超是賣轉買', () => {
    expect(computeFlow(fiveThen(-7_000, 5_000))?.change).toBe('sell-to-buy');
  });

  it('反轉時力道比例仍以絕對值計算，不會是負數', () => {
    const result = computeFlow(fiveThen(7_000, -14_000));

    expect(result?.ratio).toBeCloseTo(2, 5);
  });
});

describe('中性帶', () => {
  /*
   * 小到沒有意義的買賣超不該被講成明確方向。
   * 門檻取「前五日平均的一成」與「固定張數下限」之中較大者——
   * 只用比例的話，平均接近零時中性帶會窄到幾乎不存在。
   */
  it('今日遠小於近期平均時判為中性', () => {
    const result = computeFlow(fiveThen(10_000, 100));

    expect(result?.todayDirection).toBe('neutral');
    expect(result?.change).toBe('to-neutral');
  });

  it('雖然大於一成，但仍低於固定張數下限時也是中性', () => {
    // 前五日平均只有 1000 張，一成是 100 張；400 張過得了比例卻過不了下限
    const result = computeFlow(fiveThen(1_000, 400));

    expect(result?.todayDirection).toBe('neutral');
  });

  it('近期平均本身接近零時，方向從中性起算', () => {
    expect(computeFlow(fiveThen(0, 5_000))?.change).toBe('neutral-to-buy');
    expect(computeFlow(fiveThen(0, -5_000))?.change).toBe('neutral-to-sell');
    expect(computeFlow(fiveThen(0, 0))?.change).toBe('neutral-stay');
  });

  /* 基準沒有方向時，「幾倍」沒有意義，也不能除以零。 */
  it('近期平均接近零時力道比例回 null，不回無限大', () => {
    const result = computeFlow(fiveThen(0, 5_000));

    expect(result?.ratio).toBeNull();
    expect(result?.strength).toBeNull();
  });
});

describe('門檻可調', () => {
  /* 門檻寫死在判斷流程裡就沒辦法接到 Profile 或研究上。 */
  it('放寬持平帶會把原本的增加改判為持平', () => {
    const wide: FlowThresholds = { ...DEFAULT_FLOW_THRESHOLDS, flatHigh: 1.5 };

    expect(computeFlow(fiveThen(7_000, 10_000))?.change).toBe('buy-up');
    expect(computeFlow(fiveThen(7_000, 10_000), wide)?.change).toBe('buy-flat');
  });

  it('調高固定張數下限會把原本的買超改判為中性', () => {
    const strict: FlowThresholds = { ...DEFAULT_FLOW_THRESHOLDS, neutralFloor: 20_000 * LOT };

    expect(computeFlow(fiveThen(7_000, 10_000), strict)?.todayDirection).toBe('neutral');
  });

  it('力道分級的邊界值落在較平緩的一側', () => {
    expect(computeFlow(fiveThen(10_000, 8_000))?.strength).toBe('similar');
    expect(computeFlow(fiveThen(10_000, 12_000))?.strength).toBe('similar');
    expect(computeFlow(fiveThen(10_000, 15_000))?.strength).toBe('stronger');
    expect(computeFlow(fiveThen(10_000, 16_000))?.strength).toBe('much-stronger');
  });
});

describe('共用性', () => {
  /* 同一支函式要能餵外資、投信、之後的融資，不得寫死任何身分別。 */
  it('只吃每日淨額序列，與資料來源無關', () => {
    const foreign = computeFlow(fiveThen(7_000, 10_000));
    const margin = computeFlow(fiveThen(7_000, 10_000));

    expect(foreign).toEqual(margin);
  });
});
