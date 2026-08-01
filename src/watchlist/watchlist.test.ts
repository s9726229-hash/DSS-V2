import { describe, expect, it } from 'vitest';
import {
  addTopic,
  addWatch,
  emptyWatchlist,
  groupByTopic,
  removeTopic,
  removeWatch,
  renameTopic,
  setWatchTopics,
  watchedStockIds,
  type Watchlist,
} from './watchlist';

const AT = '2026-08-02T00:00:00.000Z';

function seeded(): Watchlist {
  return addWatch(
    addWatch(emptyWatchlist(), { stockId: '2330', stockName: '台積電', at: AT }),
    { stockId: '2454', stockName: '聯發科', at: AT },
  );
}

describe('觀察項目', () => {
  it('新增後保留代號、名稱與加入日期', () => {
    const list = addWatch(emptyWatchlist(), { stockId: '2330', stockName: '台積電', at: AT });

    expect(list.entries).toEqual([
      { stockId: '2330', stockName: '台積電', addedAt: AT, topics: [] },
    ]);
  });

  /** 同一檔重複加入不該變成兩張卡，也不該覆蓋原本的加入日期。 */
  it('重複加入同一檔不會產生第二筆', () => {
    const list = addWatch(seeded(), {
      stockId: '2330',
      stockName: '台積電（改名）',
      at: '2026-09-01T00:00:00.000Z',
    });

    expect(list.entries).toHaveLength(2);
    expect(list.entries.find((row) => row.stockId === '2330')?.addedAt).toBe(AT);
  });

  it('移除只影響指定的那一檔', () => {
    const list = removeWatch(seeded(), '2330');

    expect(list.entries.map((row) => row.stockId)).toEqual(['2454']);
  });

  it('移除不存在的股票不會出錯', () => {
    expect(() => removeWatch(emptyWatchlist(), '9999')).not.toThrow();
  });

  it('不修改原本的清單', () => {
    const before = seeded();
    addWatch(before, { stockId: '2317', stockName: '鴻海', at: AT });

    expect(before.entries).toHaveLength(2);
  });

  it('列出所有觀察中的股票代號', () => {
    expect(watchedStockIds(seeded())).toEqual(['2330', '2454']);
  });
});

describe('題材分類', () => {
  it('新增題材後保留順序', () => {
    const list = addTopic(addTopic(emptyWatchlist(), 'PCB'), '記憶體');

    expect(list.topics).toEqual(['PCB', '記憶體']);
  });

  it('題材不重複', () => {
    const list = addTopic(addTopic(emptyWatchlist(), 'PCB'), 'PCB');

    expect(list.topics).toEqual(['PCB']);
  });

  /** 規格：同一標的可在多個主題中出現，但共用同一份資料與計算結果。 */
  it('同一檔可以掛在多個題材下', () => {
    const list = setWatchTopics(addTopic(addTopic(seeded(), 'PCB'), 'AI'), '2330', ['PCB', 'AI']);

    expect(list.entries.find((row) => row.stockId === '2330')?.topics).toEqual(['PCB', 'AI']);
  });

  it('只接受已存在的題材，避免打錯字生出幽靈分類', () => {
    const list = setWatchTopics(addTopic(seeded(), 'PCB'), '2330', ['PCB', '不存在的題材']);

    expect(list.entries.find((row) => row.stockId === '2330')?.topics).toEqual(['PCB']);
  });

  it('刪除題材會一併從所有股票上移除', () => {
    const withTopic = setWatchTopics(addTopic(seeded(), 'PCB'), '2330', ['PCB']);
    const list = removeTopic(withTopic, 'PCB');

    expect(list.topics).toEqual([]);
    expect(list.entries.find((row) => row.stockId === '2330')?.topics).toEqual([]);
  });

  it('重新命名題材會同步更新股票上的標記', () => {
    const withTopic = setWatchTopics(addTopic(seeded(), 'PCB'), '2330', ['PCB']);
    const list = renameTopic(withTopic, 'PCB', '印刷電路板');

    expect(list.topics).toEqual(['印刷電路板']);
    expect(list.entries.find((row) => row.stockId === '2330')?.topics).toEqual(['印刷電路板']);
  });

  it('改名成已存在的題材不會製造重複', () => {
    const list = renameTopic(addTopic(addTopic(emptyWatchlist(), 'PCB'), 'AI'), 'PCB', 'AI');

    expect(list.topics).toEqual(['AI']);
  });
});

describe('依題材分組', () => {
  it('照題材順序輸出，未分類排在最後', () => {
    const list = setWatchTopics(
      addTopic(addTopic(seeded(), 'PCB'), 'AI'),
      '2330',
      ['AI'],
    );

    const groups = groupByTopic(list);

    expect(groups.map((group) => group.topic)).toEqual(['PCB', 'AI', null]);
    expect(groups.find((group) => group.topic === 'AI')?.stockIds).toEqual(['2330']);
    expect(groups.find((group) => group.topic === null)?.stockIds).toEqual(['2454']);
  });

  it('同一檔會出現在它所屬的每個題材下', () => {
    const list = setWatchTopics(
      addTopic(addTopic(seeded(), 'PCB'), 'AI'),
      '2330',
      ['PCB', 'AI'],
    );

    const groups = groupByTopic(list);

    expect(groups.find((group) => group.topic === 'PCB')?.stockIds).toEqual(['2330']);
    expect(groups.find((group) => group.topic === 'AI')?.stockIds).toEqual(['2330']);
  });

  it('沒有未分類股票時不輸出未分類群組', () => {
    const list = setWatchTopics(
      setWatchTopics(addTopic(seeded(), 'PCB'), '2330', ['PCB']),
      '2454',
      ['PCB'],
    );

    expect(groupByTopic(list).map((group) => group.topic)).toEqual(['PCB']);
  });

  it('空的題材仍會出現，讓使用者知道它存在', () => {
    const groups = groupByTopic(addTopic(emptyWatchlist(), 'PCB'));

    expect(groups).toEqual([{ topic: 'PCB', stockIds: [] }]);
  });

  it('完全空白時回傳空陣列', () => {
    expect(groupByTopic(emptyWatchlist())).toEqual([]);
  });
});
