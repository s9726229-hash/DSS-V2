import type { ChipResult, DailyNet, InvestorChip } from '../../dss/chip';
import {
  computeFlow,
  DEFAULT_FLOW_THRESHOLDS,
  FLOW_BASELINE_DAYS,
  type FlowChange,
  type FlowThresholds,
} from '../../dss/flow';
import { MARGIN_FLOW_THRESHOLDS } from '../../dss/margin';
import { FlowChart } from '../FlowChart';
import { CHIP_TREND_DAYS, recentTradingDays } from './chipTrend';
import {
  continuityText,
  FLOW_CHANGE_LABEL,
  FLOW_CHANGE_TONE,
  FLOW_STRENGTH_LABEL,
  INVESTOR_LABEL,
  JOINT_LABEL,
  MARGIN_CHANGE_LABEL,
  lots,
  ratioText,
  strengthText,
} from '../dssLabels';

/**
 * 一位法人的完整讀數。
 *
 * 順序就是閱讀順序：先一句話講今日相對近期是什麼情況，再給被比較的兩個數字，
 * 最後是走勢圖。5 日淨額與強度是既有指標，退到最後一行——它們仍由研究與
 * Profile 使用，只是不再是每天要讀的東西。
 */
function FlowBlock({
  label,
  series,
  thresholds = DEFAULT_FLOW_THRESHOLDS,
  changeLabel = FLOW_CHANGE_LABEL,
  toned = true,
  measure = '買賣超',
  footer = null,
}: {
  label: string;
  series: readonly DailyNet[];
  thresholds?: FlowThresholds;
  changeLabel?: Record<FlowChange, string>;
  /** 融資增減不是股價方向，也不是無爭議的多空訊號，因此不上紅綠。 */
  toned?: boolean;
  /** 這條序列量的是什麼；融資量的是餘額增減。 */
  measure?: string;
  footer?: React.ReactNode;
}) {
  const flow = computeFlow(series, thresholds);
  const trend = recentTradingDays(series);

  return (
    <section className="flow" aria-label={label}>
      <header className="flow__head">
        <h4 className="flow__name">{label}</h4>
        {flow === null ? (
          <span className="flow__pending">資料不足 6 日，無法與近期比較</span>
        ) : (
          <span
            className={
              toned
                ? `flow__change flow__change--${FLOW_CHANGE_TONE[flow.change]}`
                : 'flow__change flow__change--flat'
            }
          >
            {changeLabel[flow.change]}
          </span>
        )}
      </header>

      {flow === null ? null : (
        <>
          <div className="flow__figures">
            <span className="flow__figure">
              <span className="flow__label micro">今日</span>
              <span className="num">{lots(flow.today)}</span>
            </span>
            <span className="flow__figure">
              <span className="flow__label micro">前五日均</span>
              <span className="num">{lots(flow.baseline)}</span>
            </span>
            <span className="flow__figure">
              <span className="flow__label micro">力道</span>
              <span className="num">{ratioText(flow.ratio)}</span>
              {flow.strength === null ? null : (
                <span className="flow__tier">{FLOW_STRENGTH_LABEL[flow.strength]}</span>
              )}
            </span>
          </div>

          <FlowChart
            series={trend}
            baselineDays={FLOW_BASELINE_DAYS}
            label={label}
            measure={measure}
          />
        </>
      )}

      {footer}
    </section>
  );
}

/** 既有的 5 日淨額與強度：研究與 Profile 已改用流向，但規格仍要求顯示，退到最後一行。 */
function LegacyLine({ chip }: { chip: InvestorChip }) {
  return (
    <p className="flow__legacy">
      近 5 日 {lots(chip.fiveDayNet)}．{strengthText(chip.strength)}．
      {continuityText(chip.continuity)}
    </p>
  );
}

export function ChipPanel({ result, margin }: { result: ChipResult; margin: readonly DailyNet[] }) {
  return (
    <section className="panel" aria-label="籌碼面">
      <h3 className="panel__title micro">籌碼面</h3>

      {!result.ok ? (
        <p className="panel__pending">
          法人資料未就緒。
          <br />
          <span className="num">
            {result.lastAvailableDate
              ? `最後可用日期 ${result.lastAvailableDate}`
              : '尚無可用資料'}
          </span>
        </p>
      ) : null}

      {result.ok ? (
        <>
          <FlowBlock
            label={INVESTOR_LABEL.foreign}
            series={result.snapshot.foreign.series}
            footer={<LegacyLine chip={result.snapshot.foreign} />}
          />
          <FlowBlock
            label={INVESTOR_LABEL.trust}
            series={result.snapshot.trust.series}
            footer={<LegacyLine chip={result.snapshot.trust} />}
          />
        </>
      ) : null}

      {/* 融資與法人是不同資料來源，法人取不到時它仍然可能有值 */}
      <FlowBlock
        label={INVESTOR_LABEL.margin}
        series={margin}
        thresholds={MARGIN_FLOW_THRESHOLDS}
        changeLabel={MARGIN_CHANGE_LABEL}
        toned={false}
        measure="餘額增減"
      />

      {result.ok ? (
        <div className="panel__states">
          <span className="tag">{JOINT_LABEL[result.snapshot.joint]}</span>
          <span className="tag tag--quiet num">資料日 {result.snapshot.lastDate}</span>
        </div>
      ) : null}

      <p className="panel__note">每張圖顯示最近 {CHIP_TREND_DAYS} 個交易日；虛線為前 {FLOW_BASELINE_DAYS} 日平均。籌碼與技術獨立呈現，不合併計分，也不覆寫技術面結果。</p>
    </section>
  );
}
