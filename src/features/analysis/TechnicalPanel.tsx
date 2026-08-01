import type { TechnicalResult } from '../../dss/technical';
import { ALERT_LABEL, MONTHLY_LINE_LABEL, RECOVERY_LABEL } from '../dssLabels';

function Figure({ label, value, tone }: { label: string; value: string; tone?: 'up' | 'down' }) {
  return (
    <div className="figure">
      <span className="figure__label micro">{label}</span>
      <span className={tone ? `figure__value num figure__value--${tone}` : 'figure__value num'}>
        {value}
      </span>
    </div>
  );
}

export function TechnicalPanel({ result }: { result: TechnicalResult }) {
  if (!result.ok) {
    return (
      <section className="panel panel--pending" aria-label="技術面">
        <h3 className="panel__title micro">技術面</h3>
        <p className="panel__pending">
          價格資料不足，尚無法計算技術指標。
          <br />
          <span className="num">
            目前 {result.available} 筆，需要 {result.required} 筆
          </span>
        </p>
      </section>
    );
  }

  const { snapshot } = result;
  const biasTone = snapshot.bias20 > 0 ? 'up' : snapshot.bias20 < 0 ? 'down' : undefined;

  return (
    <section className="panel" aria-label="技術面">
      <h3 className="panel__title micro">技術面</h3>

      <div className="panel__figures">
        <Figure label="收盤" value={snapshot.close.toFixed(2)} />
        <Figure label="MA5" value={snapshot.ma5.toFixed(2)} />
        <Figure label="MA20" value={snapshot.ma20.toFixed(2)} />
        <Figure label="MA60" value={snapshot.ma60.toFixed(2)} />
        <Figure
          label="Bias20"
          value={`${snapshot.bias20 >= 0 ? '+' : ''}${snapshot.bias20.toFixed(2)}%`}
          tone={biasTone}
        />
      </div>

      <div className="lines">
        {(
          [
            ['週線', snapshot.maPositions.weekly],
            ['月線', snapshot.maPositions.monthly],
            ['季線', snapshot.maPositions.quarterly],
          ] as const
        ).map(([label, position]) => (
          <span className="lines__item" key={label}>
            <span className="lines__label">{label}</span>
            <span className={`lines__state lines__state--${position}`}>
              {position === 'above' ? '站上' : '跌破'}
            </span>
          </span>
        ))}
      </div>

      <div className="panel__states">
        <span className="tag">{MONTHLY_LINE_LABEL[snapshot.monthlyLineState]}</span>
        {snapshot.recoveryState ? (
          <span className="tag">{RECOVERY_LABEL[snapshot.recoveryState]}</span>
        ) : null}
        {snapshot.alerts.map((alert) => (
          <span className="tag tag--attention" key={alert}>
            {ALERT_LABEL[alert]}
          </span>
        ))}
      </div>

      {snapshot.alerts.length > 0 ? (
        <p className="panel__note">提醒重新檢視持倉，不是賣出指令。</p>
      ) : null}
    </section>
  );
}
