import { useEffect, useRef } from 'react';
import { StockAnalysisDetail } from '../analysis/StockAnalysisDetail';
import type { CardCore, HoldingCard, WatchCard } from '../../dss/holdingCard';
import { bandLabel } from '../../research/bandLabels';
import { METRIC_LABEL, METRIC_UNIT } from '../../research/runResearch';
import { EVIDENCE_LABEL } from '../research/evidence';
import { percent } from '../research/format';
import { ALERT_LABEL, MONTHLY_LINE_LABEL, RECOVERY_LABEL } from '../dssLabels';

const SCENARIO_LABEL = {
  establish: '建立持倉',
  'add-on': '持倉加碼',
  reentry: '退出後重進',
} as const;

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="detail__row"><span className="detail__label micro">{label}</span><span className="detail__value">{children}</span></div>;
}

/** 今日判讀只在彈窗頂部說一次；其後完整技術與籌碼內容與完整分析頁共用。 */
function Reasons({ core }: { core: CardCore }) {
  const { technical } = core.analysis;
  return <section className="detail__block" aria-label="DSS 原因"><h3 className="detail__title micro">今日判讀與 Profile</h3><ul className="detail__reasons"><li>{core.scenario === null ? <span className="detail__reason--attention">研究情境無法可靠判定</span> : <>研究情境：<strong>{SCENARIO_LABEL[core.scenario]}</strong></>}</li>{technical.ok ? <><li>月線狀態為<strong>{MONTHLY_LINE_LABEL[technical.snapshot.monthlyLineState]}</strong></li>{technical.snapshot.recoveryState === null ? null : <li>{RECOVERY_LABEL[technical.snapshot.recoveryState]}</li>}{technical.snapshot.alerts.map((alert) => <li className="detail__reason--attention" key={alert}>{ALERT_LABEL[alert]}</li>)}</> : <li className="detail__reason--attention">股價資料只有 {technical.available} 筆，需要 {technical.required} 筆，技術面無法判定</li>}{core.bands.map((band) => <li key={band.metric}>{METRIC_LABEL[band.metric]} {band.value === null ? <span className="detail__reason--attention">資料不足</span> : <><span className="num">{percent(band.value, METRIC_UNIT[band.metric])}</span>{band.band === null ? <span className="detail__muted">未設定門檻</span> : <><strong>{bandLabel(band.metric, band.band)}</strong><span className="detail__muted">{band.unverified ? '手動設定，未驗證' : band.evidence === null ? '' : `證據等級：${EVIDENCE_LABEL[band.evidence]}`}</span></>}</>}</li>)}</ul></section>;
}

export function CardDetail({ card, kind, onClose }: { card: HoldingCard | WatchCard; kind: 'holding' | 'watch'; onClose: () => void }) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => { panel.current?.focus(); const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); }; document.addEventListener('keydown', onKey); return () => document.removeEventListener('keydown', onKey); }, [onClose]);
  const holding = kind === 'holding' ? card as HoldingCard : null;
  return <div className="detail__scrim" onClick={onClose}><div className="detail" role="dialog" aria-modal="true" aria-label={`${card.stockId} ${card.stockName} 詳情`} tabIndex={-1} ref={panel} onClick={(event) => event.stopPropagation()}><header className="detail__head"><div><span className="detail__id num">{card.stockId}</span><span className="detail__name">{card.stockName}</span></div><button type="button" className="btn" onClick={onClose}>關閉</button></header><div className="detail__body"><Reasons core={card} /><StockAnalysisDetail analysis={card.analysis} />{holding === null ? <section className="detail__block" aria-label="觀察"><h3 className="detail__title micro">觀察</h3><Row label="加入日期"><span className="num">{(card as WatchCard).addedAt.slice(0, 10)}</span></Row><Row label="題材">{(card as WatchCard).topics.join('、') || '未分類'}</Row></section> : <section className="detail__block detail__block--position" aria-label="持倉"><h3 className="detail__title micro">持倉（不參與 DSS 判讀）</h3><Row label="券商成本"><span className="num">{holding.costPrice.toFixed(2)}</span></Row><Row label="研究帳本均價">{holding.addOnCostBasis === null ? '未可靠取得' : <span className="num">{holding.addOnCostBasis.toFixed(2)}</span>}</Row><Row label="券商快照價"><span className="num">{holding.snapshotPrice.toFixed(2)}</span></Row>{holding.currentPriceSource === 'market' ? <Row label={`市場收盤價 ${holding.priceDate ?? ''}`}><span className="num">{holding.currentPrice.toFixed(2)}</span></Row> : null}<Row label="股數"><span className="num">{holding.quantity.toLocaleString('en-US')}</span></Row><Row label={holding.currentPriceSource === 'market' ? '估算報酬率' : '快照報酬率'}><span className="num">{percent(holding.position.returnPercent, '%')}</span></Row></section>}</div></div></div>;
}
