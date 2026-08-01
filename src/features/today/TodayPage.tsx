import { useCallback, useEffect, useState } from 'react';
import type { WatchCard } from '../../dss/holdingCard';
import { loadTodayView, type TodayView } from '../../dss/todayView';
import {
  addTopic,
  addWatch,
  moveTopicOrder,
  moveWatchTopic,
  removeTopic,
  removeWatch,
  setWatchTopics,
  type Watchlist,
} from '../../watchlist/watchlist';
import { readWatchlist, writeWatchlist } from '../../watchlist/watchlistStore';
import { HoldingCardView, WatchCardView } from './HoldingCardView';
import { WatchlistManager } from './WatchlistManager';
import './TodayPage.css';

export function TodayPage() {
  const [view, setView] = useState<TodayView | null>(null);
  const [watchlist, setWatchlist] = useState<Watchlist | null>(null);
  const [managing, setManaging] = useState(false);
  /** 目前被拖曳的股票與它的來源題材；未拖曳時為 null。 */
  const [dragging, setDragging] = useState<{ stockId: string; from: string | null } | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null | undefined>(undefined);
  const [tab, setTab] = useState<'holdings' | 'watches' | null>(null);

  const refresh = useCallback(() => {
    void loadTodayView().then(setView);
    void readWatchlist().then(setWatchlist);
  }, []);

  useEffect(refresh, [refresh]);

  /** 每次變更都立即寫入並重算，避免畫面與儲存內容不同步。 */
  const commit = useCallback(
    (next: Watchlist) => {
      setWatchlist(next);
      void (async () => {
        await writeWatchlist(next);
        refresh();
      })();
    },
    [refresh],
  );

  if (view === null || watchlist === null) {
    return <p className="research__loading">讀取中…</p>;
  }

  /*
   * 規格：今日 DSS 先顯示庫存，再顯示觀察清單。改成分頁後由預設分頁承接這個順序。
   * 但沒有庫存時預設落在空分頁只會讓人以為壞了，此時改開觀察清單。
   */
  const active = tab ?? (view.holdings.length > 0 ? 'holdings' : 'watches');

  const byId = new Map<string, WatchCard>(view.watches.map((card) => [card.stockId, card]));
  const noThresholds =
    view.holdings.length + view.watches.length > 0 &&
    [...view.holdings, ...view.watches].every((card) =>
      card.bands.every((band) => band.band === null),
    );

  return (
    <div className="today">
      <header className="today__head">
        <h1 className="today__title">今日 DSS</h1>
        <p className="today__lede">
          依最近一個交易日的收盤資料。技術面與籌碼面各自獨立呈現，不合併為單一評分，
          也不產生買賣建議。持股損益用券商庫存快照自己的成本與現價計算，與技術指標所用的
          還原價格分屬兩個尺度，不混用。
        </p>
      </header>

      {view.holdings.length === 0 && view.watches.length === 0 ? (
        <p className="research__empty">
          尚未匯入庫存，也還沒有觀察標的。到<strong>資料中心</strong>匯入庫存檔，
          或在觀察清單分頁加入想觀察的股票。
        </p>
      ) : null}

      {noThresholds ? (
        <p className="research__empty">
          Profile 還沒有任何門檻，因此卡片上只有原始數字、沒有區間判定。
          到<strong>歷史交易研究</strong>套用候選，或在 <strong>Profile</strong> 直接設定門檻。
        </p>
      ) : null}

      <nav className="tabs" aria-label="今日檢視">
        <button
          type="button"
          className={active === 'holdings' ? 'tabs__item tabs__item--active' : 'tabs__item'}
          aria-current={active === 'holdings' ? 'page' : undefined}
          onClick={() => setTab('holdings')}
        >
          持股 <span className="num">{view.holdings.length}</span>
        </button>
        <button
          type="button"
          className={active === 'watches' ? 'tabs__item tabs__item--active' : 'tabs__item'}
          aria-current={active === 'watches' ? 'page' : undefined}
          onClick={() => setTab('watches')}
        >
          觀察清單 <span className="num">{view.watches.length}</span>
        </button>
      </nav>

      {active === 'holdings' ? (
        <section className="today__section" aria-label="持股">
          {view.holdings.length === 0 ? (
            <p className="research__empty">
              尚未匯入庫存。到<strong>資料中心</strong>匯入庫存檔。
            </p>
          ) : (
            <div className="today__grid">
              {view.holdings.map((card) => (
                <HoldingCardView key={card.stockId} card={card} />
              ))}
            </div>
          )}
        </section>
      ) : null}

      <section
        className="today__section"
        aria-label="觀察清單"
        hidden={active !== 'watches'}
      >
        <div className="today__section-head">
          <button type="button" className="btn" onClick={() => setManaging((on) => !on)}>
            {managing ? '完成' : '管理觀察清單'}
          </button>
        </div>

        {managing ? (
          <p className="today__drag-hint">
            管理模式：卡片可拖進其他題材，題材可用箭頭調整順序。這些只改變你的分類方式，
            不影響任何計算或判定。
          </p>
        ) : null}

        {managing ? (
          <WatchlistManager
            watchlist={watchlist}
            onAddStock={(stockId, stockName) =>
              commit(addWatch(watchlist, { stockId, stockName, at: new Date().toISOString() }))
            }
            onRemoveStock={(stockId) => commit(removeWatch(watchlist, stockId))}
            onAddTopic={(topic) => commit(addTopic(watchlist, topic))}
            onRemoveTopic={(topic) => commit(removeTopic(watchlist, topic))}
            onSetTopics={(stockId, topics) => commit(setWatchTopics(watchlist, stockId, topics))}
          />
        ) : null}

        {view.watches.length === 0 ? (
          <p className="research__empty">
            還沒有觀察標的。按「管理觀察清單」加入股票，同步時就會一併取得它們的資料。
          </p>
        ) : (
          view.groups.map((group, index) => (
            <div
              className={
                managing && dropTarget === group.topic
                  ? 'today__topic today__topic--drop'
                  : 'today__topic'
              }
              key={group.topic ?? '__none__'}
              onDragOver={(event) => {
                if (!managing || dragging === null) return;
                event.preventDefault();
                setDropTarget(group.topic);
              }}
              onDragLeave={() => setDropTarget(undefined)}
              onDrop={(event) => {
                event.preventDefault();
                setDropTarget(undefined);
                if (!managing || dragging === null) return;
                commit(
                  moveWatchTopic(watchlist, {
                    stockId: dragging.stockId,
                    from: dragging.from,
                    to: group.topic,
                  }),
                );
                setDragging(null);
              }}
            >
              <h3 className="today__topic-title">
                {group.topic ?? '未分類'}
                <span className="today__topic-count num">{group.stockIds.length}</span>
                {managing && group.topic !== null ? (
                  <span className="today__topic-order">
                    <button
                      type="button"
                      className="manager__remove"
                      aria-label={`${group.topic} 往前移`}
                      disabled={index === 0}
                      onClick={() => commit(moveTopicOrder(watchlist, group.topic as string, index - 1))}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="manager__remove"
                      aria-label={`${group.topic} 往後移`}
                      disabled={index >= watchlist.topics.length - 1}
                      onClick={() => commit(moveTopicOrder(watchlist, group.topic as string, index + 1))}
                    >
                      ↓
                    </button>
                  </span>
                ) : null}
              </h3>

              {group.stockIds.length === 0 ? (
                <p className="today__topic-empty">
                  {managing ? '把卡片拖進來，或在上方勾選題材。' : '這個題材還沒有股票。'}
                </p>
              ) : (
                <div className="today__grid">
                  {group.stockIds.map((stockId) => {
                    const card = byId.get(stockId);
                    return card === undefined ? null : (
                      <div
                        key={`${group.topic ?? ''}-${stockId}`}
                        draggable={managing}
                        className={managing ? 'today__draggable' : undefined}
                        onDragStart={() => setDragging({ stockId, from: group.topic })}
                        onDragEnd={() => {
                          setDragging(null);
                          setDropTarget(undefined);
                        }}
                      >
                        <WatchCardView card={card} />
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ))
        )}
      </section>
    </div>
  );
}
