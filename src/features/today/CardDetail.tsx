import { useEffect, useRef } from 'react';
import type { InvestorChip } from '../../dss/chip';
import type { CardCore, HoldingCard, WatchCard } from '../../dss/holdingCard';
import {
  computeFlow,
  DEFAULT_FLOW_THRESHOLDS,
  FLOW_BASELINE_DAYS,
  type FlowChange,
  type FlowThresholds,
} from '../../dss/flow';
import { MARGIN_FLOW_THRESHOLDS } from '../../dss/margin';
import { bandLabel } from '../../research/bandLabels';
import { METRIC_LABEL, METRIC_UNIT } from '../../research/runResearch';
import { EVIDENCE_LABEL } from '../research/evidence';
import { percent } from '../research/format';
import { FlowChart } from '../FlowChart';
import {
  ALERT_LABEL,
  continuityText,
  FLOW_CHANGE_LABEL,
  INVESTOR_LABEL,
  JOINT_LABEL,
  lots,
  MARGIN_CHANGE_LABEL,
  MONTHLY_LINE_LABEL,
  RECOVERY_LABEL,
  strengthText,
} from '../dssLabels';
import { Sparkline } from './Sparkline';

function price(value: number): string {
  return value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function money(value: number): string {
  return value.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="detail__row">
      <span className="detail__label micro">{label}</span>
      <span className="detail__value">{children}</span>
    </div>
  );
}

/**
 * DSS 原因。
 *
 * 規格要求詳情面板說明「為什麼卡片長這樣」。技術面與籌碼面各自列出，
 * 不合併成一句結論；門檻來自 Profile 時附上證據等級，手動設定的標為未驗證。
 */
function Reasons({ core }: { core: CardCore }) {
  const { technical } = core.analysis;

  return (
    <section className="detail__block" aria-label="DSS 原因">
      <h3 className="detail__title micro">DSS 原因</h3>

      <ul className="detail__reasons">
        {technical.ok ? (
          <>
            <li>
              月線狀態為
              <strong>{MONTHLY_LINE_LABEL[technical.snapshot.monthlyLineState]}</strong>
            </li>
            {technical.snapshot.recoveryState === null ? null : (
              <li>{RECOVERY_LABEL[technical.snapshot.recoveryState]}</li>
            )}
            {technical.snapshot.alerts.map((alert) => (
              <li className="detail__reason--attention" key={alert}>
                {ALERT_LABEL[alert]}
              </li>
            ))}
          </>
        ) : (
          <li className="detail__reason--attention">
            股價資料只有 {technical.available} 筆，需要 {technical.required} 筆，技術面無法判定
          </li>
        )}

        {core.bands.map((band) => (
          <li key={band.metric}>
            {METRIC_LABEL[band.metric]}
            {band.value === null ? (
              <span className="detail__reason--attention">資料不足，無法判定</span>
            ) : (
              <>
                <span className="num">{percent(band.value, METRIC_UNIT[band.metric])}</span>
                {band.band === null ? (
                  <span className="detail__muted">尚未設定門檻，因此沒有判定</span>
                ) : (
                  <>
                    落在<strong>{bandLabel(band.metric, band.band)}</strong>
                    <span className="detail__muted">
                      {band.unverified
                        ? '門檻為手動設定，未驗證'
                        : band.evidence === null
                          ? ''
                          : `證據等級：${EVIDENCE_LABEL[band.evidence]}`}
                    </span>
                  </>
                )}
              </>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** 法人原始張數與強度：規格明列詳情面板要顯示這兩個原始數字。 */
function InvestorDetail({ label, chip }: { label: string; chip: InvestorChip }) {
  return (
    <Row label={label}>
      <span className="num">近 5 日 {lots(chip.fiveDayNet)}</span>
      <span className="detail__muted num">
        {strengthText(chip.strength)}．{continuityText(chip.continuity)}
      </span>
    </Row>
  );
}

function FlowDetail({
  label,
  series,
  thresholds,
  changeLabel,
  measure,
}: {
  label: string;
  series: readonly { date: string; net: number }[];
  thresholds: FlowThresholds;
  changeLabel: Record<FlowChange, string>;
  measure: string;
}) {
  const flow = computeFlow(series, thresholds);

  return (
    <div className="detail__flow">
      <Row label={label}>
        {flow === null ? (
          <span className="detail__muted">資料不足 6 日，無法與近期比較</span>
        ) : (
          <>
            <strong>{changeLabel[flow.change]}</strong>
            <span className="num">
              今日 {lots(flow.today)}／前五日均 {lots(flow.baseline)}
              {flow.ratio === null ? '' : `／${flow.ratio.toFixed(2)} 倍`}
            </span>
          </>
        )}
      </Row>
      <FlowChart
        series={series}
        baselineDays={FLOW_BASELINE_DAYS}
        label={label}
        measure={measure}
      />
    </div>
  );
}

/**
 * 卡片詳情面板。
 *
 * 規格：點擊圖卡在右側滑出，顯示目前價格與資料模式、DSS 原因、較大走勢圖、
 * 5／20／60MA、Bias20、法人原始張數與強度；持股另顯示成本、股數與未實現損益，
 * 且不把持倉資料混入 DSS 判讀——因此持倉獨立一區並明說它不參與判定。
 */
export function CardDetail({
  card,
  kind,
  onClose,
}: {
  card: HoldingCard | WatchCard;
  kind: 'holding' | 'watch';
  onClose: () => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const { technical, chip, margin } = card.analysis;

  // 開啟時把焦點移進面板，Esc 關閉——滑出的面板若抓不到鍵盤焦點等於只給滑鼠用
  useEffect(() => {
    panel.current?.focus();

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };

    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const holding = kind === 'holding' ? (card as HoldingCard) : null;

  return (
    <div className="detail__scrim" onClick={onClose}>
      <div
        className="detail"
        role="dialog"
        aria-modal="true"
        aria-label={`${card.stockId} ${card.stockName} 詳情`}
        tabIndex={-1}
        ref={panel}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="detail__head">
          <div>
            <span className="detail__id num">{card.stockId}</span>
            <span className="detail__name">{card.stockName}</span>
          </div>
          <button type="button" className="btn" onClick={onClose}>
            關閉
          </button>
        </header>

        <div className="detail__body">
          <section className="detail__block" aria-label="價格與資料模式">
            <h3 className="detail__title micro">價格與資料模式</h3>
            <Row label="最近收盤">
              <span className="num">
                {technical.ok ? price(technical.snapshot.close) : '—'}
              </span>
            </Row>
            <Row label="資料模式">
              收盤資料
              <span className="detail__muted">盤中價格未啟用，均線一律以收盤計算</span>
            </Row>
            <Row label="市場資料日">
              <span className="num">{card.priceDate ?? '未取得'}</span>
            </Row>
            {holding === null ? null : (
              <Row label="庫存快照日">
                <span className="num">{holding.snapshotDate}</span>
              </Row>
            )}
          </section>

          <Reasons core={card} />

          <section className="detail__block" aria-label="走勢">
            <h3 className="detail__title micro">收盤與 20MA</h3>
            <div className="detail__spark">
              <Sparkline series={card.analysis.trend} />
            </div>
          </section>

          <section className="detail__block" aria-label="均線">
            <h3 className="detail__title micro">均線與乖離</h3>
            {technical.ok ? (
              <>
                <Row label="MA5">
                  <span className="num">{price(technical.snapshot.ma5)}</span>
                </Row>
                <Row label="MA20">
                  <span className="num">{price(technical.snapshot.ma20)}</span>
                </Row>
                <Row label="MA60">
                  <span className="num">{price(technical.snapshot.ma60)}</span>
                </Row>
                <Row label="Bias20">
                  <span className="num">{percent(technical.snapshot.bias20, '%')}</span>
                </Row>
              </>
            ) : (
              <p className="detail__missing">
                股價資料只有 {technical.available} 筆，需要 {technical.required} 筆
              </p>
            )}
          </section>

          <section className="detail__block" aria-label="籌碼">
            <h3 className="detail__title micro">籌碼</h3>
            {chip.ok ? (
              <>
                <InvestorDetail label={INVESTOR_LABEL.foreign} chip={chip.snapshot.foreign} />
                <InvestorDetail label={INVESTOR_LABEL.trust} chip={chip.snapshot.trust} />
                <Row label="聯合狀態">{JOINT_LABEL[chip.snapshot.joint]}</Row>
                <Row label="法人資料日">
                  <span className="num">{chip.snapshot.lastDate}</span>
                </Row>
                <FlowDetail
                  label={INVESTOR_LABEL.foreign}
                  series={chip.snapshot.foreign.series}
                  thresholds={DEFAULT_FLOW_THRESHOLDS}
                  changeLabel={FLOW_CHANGE_LABEL}
                  measure="買賣超"
                />
                <FlowDetail
                  label={INVESTOR_LABEL.trust}
                  series={chip.snapshot.trust.series}
                  thresholds={DEFAULT_FLOW_THRESHOLDS}
                  changeLabel={FLOW_CHANGE_LABEL}
                  measure="買賣超"
                />
              </>
            ) : (
              <p className="detail__missing">
                法人資料未就緒
                {chip.lastAvailableDate === null ? '' : `，最後可用日期 ${chip.lastAvailableDate}`}
              </p>
            )}

            <FlowDetail
              label={INVESTOR_LABEL.margin}
              series={margin}
              thresholds={MARGIN_FLOW_THRESHOLDS}
              changeLabel={MARGIN_CHANGE_LABEL}
              measure="餘額增減"
            />
          </section>

          {holding === null ? (
            <section className="detail__block" aria-label="觀察">
              <h3 className="detail__title micro">觀察</h3>
              <Row label="加入日期">
                <span className="num">{(card as WatchCard).addedAt.slice(0, 10)}</span>
              </Row>
              <Row label="題材">
                {(card as WatchCard).topics.length === 0
                  ? '未分類'
                  : (card as WatchCard).topics.join('、')}
              </Row>
            </section>
          ) : (
            /* 規格：不把持倉資料混入 DSS 判讀，因此獨立一區並明說它不參與判定 */
            <section className="detail__block detail__block--position" aria-label="持倉">
              <h3 className="detail__title micro">持倉（不參與 DSS 判讀）</h3>
              <Row label="庫存現價">
                <span className="num">{price(holding.currentPrice)}</span>
              </Row>
              <Row label="成本">
                <span className="num">{price(holding.costPrice)}</span>
              </Row>
              <Row label="股數">
                <span className="num">{money(holding.quantity)}</span>
              </Row>
              <Row label="未實現損益">
                <span className="num">
                  {holding.position.unrealized >= 0 ? '+' : ''}
                  {money(holding.position.unrealized)}
                </span>
              </Row>
              <Row label="報酬率">
                <span className="num">{percent(holding.position.returnPercent, '%')}</span>
              </Row>
              <Row label="持有天數">
                <span className="num">
                  {holding.heldDays === null ? '—' : `${holding.heldDays} 天`}
                </span>
              </Row>
              <p className="detail__note">
                損益用券商快照自己的成本與現價計算，與技術指標所用的還原價格分屬兩個尺度。
              </p>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
