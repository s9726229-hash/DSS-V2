import type { ChipResult, InvestorChip } from '../../dss/chip';
import { continuityText, JOINT_LABEL, lots } from '../dssLabels';

function InvestorRow({ label, chip }: { label: string; chip: InvestorChip }) {
  const tone = chip.fiveDayNet > 0 ? 'up' : chip.fiveDayNet < 0 ? 'down' : undefined;

  return (
    <div className="investor">
      <span className="investor__label">{label}</span>
      <span className={tone ? `investor__net num investor__net--${tone}` : 'investor__net num'}>
        {lots(chip.fiveDayNet)}
      </span>
      <span className="investor__strength num" title="5 日淨額 ÷ 5 日平均成交量">
        {chip.strength >= 0 ? '+' : ''}
        {chip.strength.toFixed(3)}
      </span>
      <span className="investor__continuity">{continuityText(chip.continuity)}</span>
    </div>
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

      <div className="panel__investors">
        <div className="investor investor--header">
          <span className="investor__label micro">身分</span>
          <span className="investor__net micro">5 日淨額</span>
          <span className="investor__strength micro">強度</span>
          <span className="investor__continuity micro">連續性</span>
        </div>
        <InvestorRow label="外資及陸資" chip={snapshot.foreign} />
        <InvestorRow label="投信" chip={snapshot.trust} />
      </div>

      <div className="panel__states">
        <span className="tag">{JOINT_LABEL[snapshot.joint]}</span>
        <span className="tag tag--quiet num">資料日 {snapshot.lastDate}</span>
      </div>

      <p className="panel__note">籌碼與技術獨立呈現，不合併計分，也不覆寫技術面結果。</p>
    </section>
  );
}
