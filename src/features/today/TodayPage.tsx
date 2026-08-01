import { useEffect, useState } from 'react';
import type { HoldingCard } from '../../dss/holdingCard';
import { loadHoldingCards } from '../../dss/todayView';
import { HoldingCardView } from './HoldingCardView';
import './TodayPage.css';

export function TodayPage() {
  const [cards, setCards] = useState<HoldingCard[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadHoldingCards().then((next) => {
      if (!cancelled) setCards(next);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (cards === null) {
    return <p className="research__loading">讀取中…</p>;
  }

  const unclassified = cards.every((card) => card.bands.every((band) => band.band === null));

  return (
    <div className="today">
      <header className="today__head">
        <h1 className="today__title">今日 DSS</h1>
        <p className="today__lede">
          依最近一個交易日的收盤資料。技術面與籌碼面各自獨立呈現，不合併為單一評分，
          也不產生買賣建議。損益用券商庫存快照自己的成本與現價計算，與技術指標所用的
          還原價格分屬兩個尺度，不混用。
        </p>
      </header>

      {cards.length === 0 ? (
        <p className="research__empty">
          尚未匯入庫存。請先到<strong>資料中心</strong>匯入庫存檔，再同步市場資料。
        </p>
      ) : null}

      {cards.length > 0 && unclassified ? (
        <p className="research__empty">
          Profile 還沒有任何門檻，因此卡片上只有原始數字、沒有區間判定。
          到<strong>歷史交易研究</strong>套用候選，或在 <strong>Profile</strong> 直接設定門檻。
        </p>
      ) : null}

      <section className="today__grid" aria-label="持股">
        {cards.map((card) => (
          <HoldingCardView key={card.stockId} card={card} />
        ))}
      </section>
    </div>
  );
}
