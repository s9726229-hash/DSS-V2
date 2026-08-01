/**
 * 觀察清單。
 *
 * 規格：觀察清單可按 PCB、記憶體等題材分類；同一標的可在多個主題中出現，
 * 但共用同一份資料與計算結果。因此題材與股票是多對多，
 * 而每檔股票在清單裡只存在一筆——分組是顯示層的事，計算只做一次。
 */
export type WatchEntry = {
  stockId: string;
  stockName: string;
  addedAt: string;
  /** 所屬題材名稱；空陣列代表未分類。 */
  topics: string[];
};

export type Watchlist = {
  version: 1;
  /** 題材名稱，順序即顯示順序。 */
  topics: string[];
  entries: WatchEntry[];
};

export type TopicGroup = {
  /** null 代表未分類。 */
  topic: string | null;
  stockIds: string[];
};

export function emptyWatchlist(): Watchlist {
  return { version: 1, topics: [], entries: [] };
}

export function watchedStockIds(list: Watchlist): string[] {
  return list.entries.map((entry) => entry.stockId);
}

/** 已在清單中的股票不重複加入，也不覆蓋原本的加入日期。 */
export function addWatch(
  list: Watchlist,
  { stockId, stockName, at }: { stockId: string; stockName: string; at: string },
): Watchlist {
  if (list.entries.some((entry) => entry.stockId === stockId)) return list;

  return {
    ...list,
    entries: [...list.entries, { stockId, stockName, addedAt: at, topics: [] }],
  };
}

export function removeWatch(list: Watchlist, stockId: string): Watchlist {
  return { ...list, entries: list.entries.filter((entry) => entry.stockId !== stockId) };
}

export function addTopic(list: Watchlist, topic: string): Watchlist {
  const name = topic.trim();
  if (name === '' || list.topics.includes(name)) return list;

  return { ...list, topics: [...list.topics, name] };
}

/**
 * 指定一檔股票的題材。
 *
 * 只接受已存在的題材：允許任意字串會讓打錯字的名稱變成一個只有一檔股票的
 * 幽靈分類，而且使用者在題材清單上看不到它、刪不掉。
 */
export function setWatchTopics(list: Watchlist, stockId: string, topics: string[]): Watchlist {
  const allowed = topics.filter((topic) => list.topics.includes(topic));

  return {
    ...list,
    entries: list.entries.map((entry) =>
      entry.stockId === stockId ? { ...entry, topics: allowed } : entry,
    ),
  };
}

/** 刪除題材時一併從所有股票上移除，不留下指向不存在題材的標記。 */
export function removeTopic(list: Watchlist, topic: string): Watchlist {
  return {
    topics: list.topics.filter((name) => name !== topic),
    entries: list.entries.map((entry) => ({
      ...entry,
      topics: entry.topics.filter((name) => name !== topic),
    })),
    version: list.version,
  };
}

export function renameTopic(list: Watchlist, from: string, to: string): Watchlist {
  const name = to.trim();
  if (name === '' || !list.topics.includes(from)) return list;

  // 改成已存在的名稱等於合併，去重避免同名出現兩次
  const topics = list.topics.map((topic) => (topic === from ? name : topic));

  return {
    version: list.version,
    topics: [...new Set(topics)],
    entries: list.entries.map((entry) => ({
      ...entry,
      topics: [...new Set(entry.topics.map((topic) => (topic === from ? name : topic)))],
    })),
  };
}

/**
 * 依題材分組供顯示。
 *
 * 空的題材仍然輸出，否則使用者建了分類卻看不到它，會以為沒建成功。
 * 未分類只在真的有股票時才出現。
 */
export function groupByTopic(list: Watchlist): TopicGroup[] {
  const groups: TopicGroup[] = list.topics.map((topic) => ({
    topic,
    stockIds: list.entries
      .filter((entry) => entry.topics.includes(topic))
      .map((entry) => entry.stockId),
  }));

  const uncategorised = list.entries
    .filter((entry) => entry.topics.length === 0)
    .map((entry) => entry.stockId);

  if (uncategorised.length > 0) groups.push({ topic: null, stockIds: uncategorised });

  return groups;
}
