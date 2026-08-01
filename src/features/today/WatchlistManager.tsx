import { useState } from 'react';
import type { Watchlist } from '../../watchlist/watchlist';

const STOCK_ID_PATTERN = /^[0-9A-Z]{4,6}$/;

/**
 * 觀察清單管理。
 *
 * 規格：平常不啟用拖曳，進入管理模式後才能調整分類；拖曳只改個人組織，
 * 不改分析參數。這一版先做新增、刪除與題材指派，拖曳排序留待後續。
 */
export function WatchlistManager({
  watchlist,
  onAddStock,
  onRemoveStock,
  onAddTopic,
  onRemoveTopic,
  onSetTopics,
}: {
  watchlist: Watchlist;
  onAddStock: (stockId: string, stockName: string) => void;
  onRemoveStock: (stockId: string) => void;
  onAddTopic: (topic: string) => void;
  onRemoveTopic: (topic: string) => void;
  onSetTopics: (stockId: string, topics: string[]) => void;
}) {
  const [stockId, setStockId] = useState('');
  const [stockName, setStockName] = useState('');
  const [topic, setTopic] = useState('');

  const normalisedId = stockId.trim().toUpperCase();
  const idValid = STOCK_ID_PATTERN.test(normalisedId);
  const duplicate = watchlist.entries.some((entry) => entry.stockId === normalisedId);

  const submitStock = () => {
    if (!idValid || duplicate) return;
    onAddStock(normalisedId, stockName.trim() === '' ? normalisedId : stockName.trim());
    setStockId('');
    setStockName('');
  };

  const submitTopic = () => {
    if (topic.trim() === '') return;
    onAddTopic(topic);
    setTopic('');
  };

  return (
    <div className="manager">
      <p className="manager__note">
        加入的股票會在下次同步時一併取得價格與法人資料，每檔約 4 次 FinMind 請求。
        題材分類只影響顯示分組，不影響任何計算。
      </p>

      <div className="manager__row">
        <label className="manager__field">
          <span className="manager__label micro">股票代號</span>
          <input
            className="manager__input num"
            value={stockId}
            placeholder="2330"
            onChange={(event) => setStockId(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') submitStock();
            }}
          />
        </label>
        <label className="manager__field manager__field--wide">
          <span className="manager__label micro">名稱（可留空）</span>
          <input
            className="manager__input"
            value={stockName}
            placeholder="台積電"
            onChange={(event) => setStockName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') submitStock();
            }}
          />
        </label>
        <button type="button" className="btn" disabled={!idValid || duplicate} onClick={submitStock}>
          加入觀察
        </button>
      </div>

      {stockId.trim() !== '' && !idValid ? (
        <p className="manager__hint">股票代號是 4 到 6 位的數字或大寫英數，例如 2330、0050。</p>
      ) : null}
      {duplicate ? <p className="manager__hint">{normalisedId} 已經在觀察清單裡。</p> : null}

      <div className="manager__row">
        <label className="manager__field manager__field--wide">
          <span className="manager__label micro">新增題材</span>
          <input
            className="manager__input"
            value={topic}
            placeholder="PCB"
            onChange={(event) => setTopic(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') submitTopic();
            }}
          />
        </label>
        <button type="button" className="btn" disabled={topic.trim() === ''} onClick={submitTopic}>
          新增題材
        </button>
      </div>

      {watchlist.topics.length > 0 ? (
        <div className="manager__topics">
          {watchlist.topics.map((name) => (
            <span className="manager__topic" key={name}>
              {name}
              <button
                type="button"
                className="manager__remove"
                aria-label={`刪除題材 ${name}`}
                title="刪除這個題材，股票不會被移除"
                onClick={() => onRemoveTopic(name)}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      ) : null}

      {watchlist.entries.length > 0 ? (
        <table className="checkpoints manager__table">
          <thead>
            <tr>
              <th>股票</th>
              <th>題材</th>
              <th>移除</th>
            </tr>
          </thead>
          <tbody>
            {watchlist.entries.map((entry) => (
              <tr key={entry.stockId}>
                <td>
                  <span className="num">{entry.stockId}</span> {entry.stockName}
                </td>
                <td>
                  {watchlist.topics.length === 0 ? (
                    <span className="manager__hint">尚未建立任何題材</span>
                  ) : (
                    watchlist.topics.map((name) => (
                      <label className="manager__check" key={name}>
                        <input
                          type="checkbox"
                          checked={entry.topics.includes(name)}
                          onChange={(event) =>
                            onSetTopics(
                              entry.stockId,
                              event.target.checked
                                ? [...entry.topics, name]
                                : entry.topics.filter((topicName) => topicName !== name),
                            )
                          }
                        />
                        {name}
                      </label>
                    ))
                  )}
                </td>
                <td>
                  <button
                    type="button"
                    className="manager__remove"
                    aria-label={`移除 ${entry.stockId}`}
                    onClick={() => onRemoveStock(entry.stockId)}
                  >
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}
