import type {
  CardBand,
  CardCore,
  DataCompleteness,
  HoldingCard,
  WatchCard,
} from '../../dss/holdingCard';
import { bandLabel } from '../../research/bandLabels';
import { METRIC_LABEL, METRIC_UNIT } from '../../research/runResearch';
import { ASSET_LABEL } from '../research/evidence';
import { percent } from '../research/format';
import { continuityText, JOINT_LABEL, lots, MONTHLY_LINE_LABEL } from '../dssLabels';
import { Sparkline } from './Sparkline';

const COMPLETENESS_LABEL: Record<DataCompleteness, string> = {
  complete: '資料完整',
  partial: '部分資料',
  none: '資料不足',
};

function money(value: number): string {
  return value.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

function price(value: number): string {
  return value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** 台股慣例紅漲綠跌。這裡只表示方向，不表示好壞。 */
function tone(value: number | null): string {
  if (value === null || value === 0) return '';
  return value > 0 ? ' card__value--up' : ' card__value--down';
}

/**
 * Profile 判定。
 *
 * Profile 還沒設門檻時顯示「未分類」而不是猜一個——沒有門檻就沒有判定。
 * 門檻若來自手動設定，加註未驗證，避免看起來像研究出來的結論。
 */
function BandChip({ band }: { band: CardBand }) {
  if (band.value === null) {
    return (
      <div className="band-chip band-chip--muted">
        <span className="band-chip__metric">{METRIC_LABEL[band.metric]}</span>
        <span className="band-chip__state">資料不足</span>
      </div>
    );
  }

  return (
    <div className={band.band === null ? 'band-chip band-chip--muted' : 'band-chip'}>
      <span className="band-chip__metric">{METRIC_LABEL[band.metric]}</span>
      <span className="band-chip__value num">{percent(band.value, METRIC_UNIT[band.metric])}</span>
      <span className="band-chip__state">
        {band.band === null ? '未分類' : bandLabel(band.metric, band.band)}
      </span>
      {band.unverified ? <span className="band-chip__flag">未驗證</span> : null}
    </div>
  );
}

/** 識別列、Profile 判定列與技術籌碼列由兩種卡共用；差別只在中間的摘要。 */
function CardFrame({
  core,
  tags,
  dataTitle,
  children,
}: {
  core: CardCore;
  tags: string[];
  dataTitle: string;
  children: React.ReactNode;
}) {
  const { analysis } = core;

  return (
    <article className="card" aria-label={`${core.stockId} ${core.stockName}`}>
      <header className="card__head">
        <div className="card__identity">
          <span className="card__id num">{core.stockId}</span>
          <span className="card__name">{core.stockName}</span>
          <span className="card__class">{ASSET_LABEL[core.assetClass]}</span>
          {tags.map((tag) => (
            <span className="card__class" key={tag}>
              {tag}
            </span>
          ))}
        </div>
        <span
          className={`card__completeness card__completeness--${core.completeness}`}
          title={dataTitle}
        >
          {COMPLETENESS_LABEL[core.completeness]}
        </span>
      </header>

      <div className="card__summary">
        <div className="card__summary-body">{children}</div>
        <Sparkline series={analysis.trend} />
      </div>

      <div className="card__bands">
        {core.bands.map((band) => (
          <BandChip key={band.metric} band={band} />
        ))}
      </div>

      <div className="card__readouts">
        <div className="card__readout">
          <span className="card__label micro">技術</span>
          {analysis.technical.ok ? (
            <span className="card__readout-body num">
              MA5 {price(analysis.technical.snapshot.ma5)}．MA20{' '}
              {price(analysis.technical.snapshot.ma20)}．MA60{' '}
              {price(analysis.technical.snapshot.ma60)}
              <span className="card__tag">
                {MONTHLY_LINE_LABEL[analysis.technical.snapshot.monthlyLineState]}
              </span>
            </span>
          ) : (
            <span className="card__readout-body card__readout-body--missing">
              股價資料只有 {analysis.technical.available} 筆，需要{' '}
              {analysis.technical.required} 筆
            </span>
          )}
        </div>

        <div className="card__readout">
          <span className="card__label micro">籌碼</span>
          {analysis.chip.ok ? (
            <span className="card__readout-body num">
              外資 {lots(analysis.chip.snapshot.foreign.fiveDayNet)}（
              {continuityText(analysis.chip.snapshot.foreign.continuity)}）．投信{' '}
              {lots(analysis.chip.snapshot.trust.fiveDayNet)}（
              {continuityText(analysis.chip.snapshot.trust.continuity)}）
              <span className="card__tag">{JOINT_LABEL[analysis.chip.snapshot.joint]}</span>
            </span>
          ) : (
            <span className="card__readout-body card__readout-body--missing">
              法人資料未就緒
              {analysis.chip.lastAvailableDate === null
                ? ''
                : `，最後可用日期 ${analysis.chip.lastAvailableDate}`}
            </span>
          )}
        </div>
      </div>
    </article>
  );
}

/** 觀察卡刻意不顯示成本、損益與持有天數——規格要求那些只屬於持股卡。 */
export function WatchCardView({ card }: { card: WatchCard }) {
  return (
    <CardFrame
      core={card}
      tags={card.topics}
      dataTitle={`市場資料 ${card.priceDate ?? '未取得'}`}
    >
      <div className="card__watch">
        <span className="card__label micro">加入觀察</span>
        <span className="card__value num">{card.addedAt.slice(0, 10)}</span>
        {card.topics.length === 0 ? <span className="card__untagged">未分類</span> : null}
      </div>
    </CardFrame>
  );
}

export function HoldingCardView({ card }: { card: HoldingCard }) {
  const { position } = card;

  return (
    <CardFrame
      core={card}
      tags={[card.tradeType]}
      dataTitle={`市場資料 ${card.priceDate ?? '未取得'}．庫存快照 ${card.snapshotDate}`}
    >

      {/* 持股摘要：損益一律用券商快照自己的成本與現價，與技術指標的還原價分開 */}
      <div className="card__position">
        <div className="card__figure">
          <span className="card__label micro">庫存現價</span>
          <span className="card__value num">{price(card.currentPrice)}</span>
        </div>
        <div className="card__figure">
          <span className="card__label micro">成本</span>
          <span className="card__value num">{price(card.costPrice)}</span>
        </div>
        <div className="card__figure">
          <span className="card__label micro">股數</span>
          <span className="card__value num">{money(card.quantity)}</span>
        </div>
        <div className="card__figure">
          <span className="card__label micro">未實現損益</span>
          <span className={`card__value num${tone(position.unrealized)}`}>
            {position.unrealized >= 0 ? '+' : ''}
            {money(position.unrealized)}
          </span>
        </div>
        <div className="card__figure">
          <span className="card__label micro">報酬率</span>
          <span className={`card__value num${tone(position.returnPercent)}`}>
            {percent(position.returnPercent, '%')}
          </span>
        </div>
        <div className="card__figure">
          <span className="card__label micro">持有天數</span>
          <span className="card__value num">
            {card.heldDays === null ? '—' : `${card.heldDays} 天`}
          </span>
        </div>
      </div>

    </CardFrame>
  );
}
