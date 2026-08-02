import type { DailyNet } from '../../dss/chip';
import type {
  CardBand,
  CardCore,
  DataCompleteness,
  HoldingCard,
  WatchCard,
} from '../../dss/holdingCard';
import { bandLabel } from '../../research/bandLabels';
import { METRIC_LABEL, METRIC_UNIT, type ResearchMetric } from '../../research/runResearch';
import { ASSET_LABEL } from '../research/evidence';
import { percent } from '../research/format';
import {
  computeFlow,
  DEFAULT_FLOW_THRESHOLDS,
  FLOW_BASELINE_DAYS,
  type FlowChange,
  type FlowThresholds,
} from '../../dss/flow';
import { MARGIN_FLOW_THRESHOLDS } from '../../dss/margin';
import { FlowChart } from '../FlowChart';
import {
  ALERT_LABEL,
  FLOW_CHANGE_LABEL,
  FLOW_CHANGE_TONE,
  INVESTOR_LABEL,
  MARGIN_CHANGE_LABEL,
  lots,
  MONTHLY_LINE_LABEL,
  RECOVERY_LABEL,
} from '../dssLabels';
import { Sparkline } from './Sparkline';

const COMPLETENESS_LABEL: Record<DataCompleteness, string> = {
  complete: '資料完整',
  partial: '部分資料',
  none: '資料不足',
};

/** 方塊裡的指標標籤要短，長標籤會把四格擠成兩行。 */
const BOX_LABEL: Record<ResearchMetric, string> = {
  bias20: '20MA 乖離',
  foreignFlow: '外資流向',
  trustFlow: '投信流向',
  marginFlow: '融資流向',
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
  return value > 0 ? ' card__lead-value--up' : ' card__lead-value--down';
}

/**
 * 卡片上唯一的大數字。
 *
 * 一張卡上十幾個數字都用同樣的字級時，眼睛沒有落點，掃過去等於沒看。
 * 因此只留一個放大的讀數當進入點，其餘一律維持小字。
 */
function LeadReadout({
  value,
  label,
  numeric,
  note,
}: {
  value: string;
  label: string;
  /** 決定紅綠方向；沒有方向意義時給 null。 */
  numeric: number | null;
  note: string | null;
}) {
  return (
    <div className="card__lead">
      <span className={`card__lead-value num${tone(numeric)}`}>{value}</span>
      <span className="card__lead-label micro">{label}</span>
      {note === null ? null : <span className="card__lead-note num">{note}</span>}
    </div>
  );
}

/**
 * 指標方塊。
 *
 * 判定狀態只在真的有門檻時才寫。沒有門檻就沒有判定——但也不能留白，
 * 否則看起來像「沒事」，所以明說是還沒設門檻。資料不足優先於一切。
 */
function MetricBox({ band }: { band: CardBand }) {
  if (band.value === null) {
    return (
      <div className="metric metric--missing">
        <span className="metric__label micro">{BOX_LABEL[band.metric]}</span>
        <span className="metric__value num">—</span>
        <span className="metric__state">資料不足</span>
      </div>
    );
  }

  return (
    <div className="metric">
      <span className="metric__label micro">{BOX_LABEL[band.metric]}</span>
      <span className="metric__value num">{percent(band.value, METRIC_UNIT[band.metric])}</span>
      <span className="metric__state">
        {band.band === null ? '未設門檻' : bandLabel(band.metric, band.band)}
        {band.unverified ? <span className="metric__flag">未驗證</span> : null}
      </span>
    </div>
  );
}

/** 天數、日期這類沒有門檻可判定的資訊，用同一個方塊外觀但不假裝有狀態。 */
function PlainBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <span className="metric__label micro">{label}</span>
      <span className="metric__value num">{value}</span>
      <span className="metric__state">—</span>
    </div>
  );
}

/**
 * 技術面的一句話。
 *
 * 月線狀態、回穩與提醒原本散在標籤與內文裡，要拼起來才知道現在是什麼情況。
 * 算不出來時整句改成缺多少筆資料，並用 amber 標示——那是資料狀態，不是跌。
 */
function StatusLine({ core }: { core: CardCore }) {
  const { technical } = core.analysis;

  if (!technical.ok) {
    return (
      <p className="card__status card__status--missing">
        股價資料只有 {technical.available} 筆，需要 {technical.required} 筆才算得出均線
      </p>
    );
  }

  const { monthlyLineState, recoveryState, alerts } = technical.snapshot;

  return (
    <p className="card__status">
      <span className="card__status-main">{MONTHLY_LINE_LABEL[monthlyLineState]}</span>
      {/* 回穩是狀態描述，提醒才需要跳出來，兩者不共用同一個顏色 */}
      {recoveryState === null ? null : (
        <span className="card__status-note">{RECOVERY_LABEL[recoveryState]}</span>
      )}
      {alerts.map((alert) => (
        <span className="card__status-note card__status-note--alert" key={alert}>
          {ALERT_LABEL[alert]}
        </span>
      ))}
    </p>
  );
}

/**
 * 卡片上的一條序列。
 *
 * 每天要讀的是「今日相對近期是增加、減少還是轉向」，所以方向變化排在最前面，
 * 兩個被比較的數字緊接在後——期間一定要標，否則今日與近期平均並排會看起來自相矛盾。
 *
 * 外資、投信、融資共用這一個元件；差別只在門檻、用語與要不要上紅綠。
 */
function FlowLine({
  label,
  series,
  thresholds,
  changeLabel,
  toned,
  measure = '買賣超',
}: {
  label: string;
  series: readonly DailyNet[];
  thresholds: FlowThresholds;
  changeLabel: Record<FlowChange, string>;
  /** 融資增減不是股價方向，也不是無爭議的多空訊號，因此不上紅綠。 */
  toned: boolean;
  measure?: string;
}) {
  const flow = computeFlow(series, thresholds);

  if (flow === null) {
    return (
      <span className="card__investor card__investor--missing">
        <span className="card__investor-name">{label}</span>
        <span>資料不足 6 日，無法與近期比較</span>
      </span>
    );
  }

  return (
    <span className="card__investor">
      <span className="card__investor-name">{label}</span>
      <span
        className={
          toned
            ? `card__investor-change card__investor-change--${FLOW_CHANGE_TONE[flow.change]}`
            : 'card__investor-change card__investor-change--flat'
        }
      >
        {changeLabel[flow.change]}
      </span>
      <span className="card__investor-figure num">
        今日 {lots(flow.today)}／前五日均 {lots(flow.baseline)}
        {flow.ratio === null ? '' : `／${flow.ratio.toFixed(2)}倍`}
      </span>
      <FlowChart
        series={series}
        baselineDays={FLOW_BASELINE_DAYS}
        label={label}
        measure={measure}
      />
    </span>
  );
}

function ChipRow({ core }: { core: CardCore }) {
  const { chip, margin } = core.analysis;

  return (
    <div className="card__chips">
      {chip.ok ? (
        <>
          <FlowLine
            label={INVESTOR_LABEL.foreign}
            series={chip.snapshot.foreign.series}
            thresholds={DEFAULT_FLOW_THRESHOLDS}
            changeLabel={FLOW_CHANGE_LABEL}
            toned
          />
          <FlowLine
            label={INVESTOR_LABEL.trust}
            series={chip.snapshot.trust.series}
            thresholds={DEFAULT_FLOW_THRESHOLDS}
            changeLabel={FLOW_CHANGE_LABEL}
            toned
          />
        </>
      ) : (
        <span className="card__chips--missing">
          法人資料未就緒
          {chip.lastAvailableDate === null ? '' : `，最後可用日期 ${chip.lastAvailableDate}`}
        </span>
      )}

      {/* 融資與法人是不同資料來源，法人取不到時它仍然可能有值 */}
      <FlowLine
        label={INVESTOR_LABEL.margin}
        series={margin}
        thresholds={MARGIN_FLOW_THRESHOLDS}
        changeLabel={MARGIN_CHANGE_LABEL}
        toned={false}
        measure="餘額增減"
      />
    </div>
  );
}

/**
 * 兩種卡共用的骨架：識別、大數字、狀態句、指標方塊、法人、可收合的明細。
 *
 * 明細預設收起是因為成本與均線這類數字每天都在，卻只在要加減碼時才看；
 * 它們留在卡上會把真正每天要掃的東西擠掉。收起不是刪除，點一下就在原地展開。
 */
function CardFrame({
  core,
  tags,
  dataTitle,
  lead,
  boxes,
  details,
  onOpenDetail,
}: {
  core: CardCore;
  tags: string[];
  dataTitle: string;
  lead: React.ReactNode;
  boxes: React.ReactNode;
  details: React.ReactNode;
  /** 未提供時整張卡不可點——管理觀察清單時要讓位給拖曳。 */
  onOpenDetail?: () => void;
}) {
  const { technical } = core.analysis;

  /*
   * 卡片裡本來就有摘要、按鈕與核取方塊，整張包成 <button> 是無效的 HTML。
   * 因此改成在卡片上掛 onClick，並忽略來自互動元素的點擊；
   * 鍵盤使用者走標題列那顆「詳情」按鈕。
   */
  const openFromCard = (event: React.MouseEvent) => {
    if (onOpenDetail === undefined) return;
    if ((event.target as HTMLElement).closest('button, summary, input, label, a')) return;
    onOpenDetail();
  };

  return (
    <article
      className={onOpenDetail === undefined ? 'card' : 'card card--clickable'}
      aria-label={`${core.stockId} ${core.stockName}`}
      onClick={openFromCard}
    >
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
        <div className="card__head-right">
          <span
            className={`card__completeness card__completeness--${core.completeness}`}
            title={dataTitle}
          >
            {COMPLETENESS_LABEL[core.completeness]}
          </span>
          {onOpenDetail === undefined ? null : (
            <button
              type="button"
              className="card__detail-open"
              onClick={onOpenDetail}
              aria-label={`${core.stockId} ${core.stockName} 詳情`}
            >
              詳情
            </button>
          )}
        </div>
      </header>

      <div className="card__summary">
        {lead}
        <Sparkline series={core.analysis.trend} />
      </div>

      <StatusLine core={core} />

      <div className="card__metrics">{boxes}</div>

      <ChipRow core={core} />

      <details className="card__details">
        <summary className="card__details-summary">明細</summary>
        <div className="card__details-body num">
          {details}
          {technical.ok ? (
            <span className="card__detail">
              MA5 {price(technical.snapshot.ma5)}．MA20 {price(technical.snapshot.ma20)}．MA60{' '}
              {price(technical.snapshot.ma60)}
            </span>
          ) : null}
        </div>
      </details>
    </article>
  );
}

/** 觀察卡刻意不顯示成本、損益與持有天數——規格要求那些只屬於持股卡。 */
export function WatchCardView({
  card,
  onOpenDetail,
}: {
  card: WatchCard;
  onOpenDetail?: () => void;
}) {
  // 沒有損益可看，改用乖離率當落點；它同時是三個判定指標裡最直觀的一個
  const bias = card.bands.find((band) => band.metric === 'bias20');

  return (
    <CardFrame
      core={card}
      tags={card.topics}
      dataTitle={`市場資料 ${card.priceDate ?? '未取得'}`}
      onOpenDetail={onOpenDetail}
      lead={
        <LeadReadout
          value={bias === undefined || bias.value === null ? '—' : percent(bias.value, '%')}
          label={METRIC_LABEL.bias20}
          numeric={bias?.value ?? null}
          note={bias?.band === null || bias === undefined ? null : bandLabel('bias20', bias.band)}
        />
      }
      /* 乖離率已經是大數字，方塊只放另外兩個判定指標，不重複 */
      boxes={
        <>
          {card.bands
            .filter((band) => band.metric !== 'bias20')
            .map((band) => (
              <MetricBox key={band.metric} band={band} />
            ))}
          <PlainBox label="加入觀察" value={card.addedAt.slice(0, 10)} />
        </>
      }
      details={
        <span className="card__detail">
          {card.topics.length === 0 ? '未分類' : `題材 ${card.topics.join('、')}`}
        </span>
      }
    />
  );
}

export function HoldingCardView({
  card,
  onOpenDetail,
}: {
  card: HoldingCard;
  onOpenDetail?: () => void;
}) {
  const { position } = card;

  return (
    <CardFrame
      core={card}
      tags={[card.tradeType]}
      dataTitle={`市場資料 ${card.priceDate ?? '未取得'}．庫存快照 ${card.snapshotDate}`}
      onOpenDetail={onOpenDetail}
      lead={
        <LeadReadout
          value={percent(position.returnPercent, '%')}
          label="報酬率"
          numeric={position.returnPercent}
          /* 損益一律用券商快照的成本與現價，與技術指標的還原價分屬兩個尺度 */
          note={`庫存現價 ${price(card.currentPrice)}`}
        />
      }
      boxes={
        <>
          {card.bands.map((band) => (
            <MetricBox key={band.metric} band={band} />
          ))}
          <PlainBox
            label="持有天數"
            value={card.heldDays === null ? '—' : `${card.heldDays} 天`}
          />
        </>
      }
      details={
        <span className="card__detail">
          成本 {price(card.costPrice)}．股數 {money(card.quantity)}．未實現{' '}
          <span className={position.unrealized >= 0 ? 'card__gain' : 'card__loss'}>
            {position.unrealized >= 0 ? '+' : ''}
            {money(position.unrealized)}
          </span>
        </span>
      }
    />
  );
}
