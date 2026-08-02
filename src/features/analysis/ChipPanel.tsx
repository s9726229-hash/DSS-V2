import type { ChipResult, InvestorChip } from '../../dss/chip';
import { computeFlow, FLOW_BASELINE_DAYS } from '../../dss/flow';
import { FlowChart } from '../FlowChart';
import {
  continuityText,
  FLOW_CHANGE_LABEL,
  FLOW_CHANGE_TONE,
  FLOW_STRENGTH_LABEL,
  INVESTOR_LABEL,
  JOINT_LABEL,
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
function InvestorBlock({ label, chip }: { label: string; chip: InvestorChip }) {
  const flow = computeFlow(chip.series);

  return (
    <section className="flow" aria-label={label}>
      <header className="flow__head">
        <h4 className="flow__name">{label}</h4>
        {flow === null ? (
          <span className="flow__pending">法人資料不足 6 日，無法與近期比較</span>
        ) : (
          <span className={`flow__change flow__change--${FLOW_CHANGE_TONE[flow.change]}`}>
            {FLOW_CHANGE_LABEL[flow.change]}
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

          <FlowChart series={chip.series} baselineDays={FLOW_BASELINE_DAYS} label={label} />
          <p className="flow__legend micro">
            每日買賣超，虛線為前 {FLOW_BASELINE_DAYS} 日平均．分級門檻為市場慣例，未經驗證
          </p>
        </>
      )}

      <p className="flow__legacy">
        近 5 日 {lots(chip.fiveDayNet)}．{strengthText(chip.strength)}．
        {continuityText(chip.continuity)}
      </p>
    </section>
  );
}

export function ChipPanel({ result }: { result: ChipResult }) {
  if (!result.ok) {
    return (
      <section className="panel panel--pending" aria-label="籌碼面">
        <h3 className="panel__title micro">籌碼面</h3>
        <p className="panel__pending">
          法人資料未就緒。
          <br />
          <span className="num">
            {result.lastAvailableDate
              ? `最後可用日期 ${result.lastAvailableDate}`
              : '尚無可用資料'}
          </span>
        </p>
      </section>
    );
  }

  const { snapshot } = result;

  return (
    <section className="panel" aria-label="籌碼面">
      <h3 className="panel__title micro">籌碼面</h3>

      <InvestorBlock label={INVESTOR_LABEL.foreign} chip={snapshot.foreign} />
      <InvestorBlock label={INVESTOR_LABEL.trust} chip={snapshot.trust} />

      <div className="panel__states">
        <span className="tag">{JOINT_LABEL[snapshot.joint]}</span>
        <span className="tag tag--quiet num">資料日 {snapshot.lastDate}</span>
      </div>

      <p className="panel__note">籌碼與技術獨立呈現，不合併計分，也不覆寫技術面結果。</p>
    </section>
  );
}
