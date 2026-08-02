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
  /**
   * 已經向 FinMind 問過名稱，但那邊沒有這個代號。
   * 只有真的問到回應才會標記——連線失敗不算，否則斷一次網就會被永久誤判成打錯字。
   */
  nameNotFound?: true;
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

/**
 * 名稱還是代號本身，代表使用者加入時留空、還沒補回真正的名稱。
 *
 * 查過而查無的不再問：代號打錯時每次同步都重問一次，會無止盡地吃額度，
 * 而答案永遠一樣。畫面會標示查無此代號，讓使用者自己修掉。
 */
export function needsNameLookup(entry: WatchEntry): boolean {
  return entry.nameNotFound !== true && entry.stockName.trim() === entry.stockId;
}

/** 寫回查詢結果；`stockName` 為 null 代表查無此代號。找不到這檔時原樣回傳。 */
export function resolveWatchName(
  list: Watchlist,
  stockId: string,
  stockName: string | null,
): Watchlist {
  if (!list.entries.some((entry) => entry.stockId === stockId)) return list;

  return {
    ...list,
    entries: list.entries.map((entry) => {
      if (entry.stockId !== stockId) return entry;
      if (stockName === null) return { ...entry, nameNotFound: true };

      // 查到名稱就重建整筆，順手讓 nameNotFound 消失，不留下已經不成立的標記
      return {
        stockId: entry.stockId,
        stockName,
        addedAt: entry.addedAt,
        topics: entry.topics,
      };
    }),
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

/**
 * 把一檔股票移到指定題材。
 *
 * 規格：拖曳只改個人組織，不改分析參數。因此這裡只動 topics，
 * 不碰加入日期，也不影響任何計算結果。
 *
 * 從某個題材拖到另一個題材時，來源題材要移除、目標題材要加上；
 * 拖到未分類（to 為 null）則只是從來源題材移除，其他題材維持不變。
 */
export function moveWatchTopic(
  list: Watchlist,
  { stockId, from, to }: { stockId: string; from: string | null; to: string | null },
): Watchlist {
  if (to !== null && !list.topics.includes(to)) return list;

  return {
    ...list,
    entries: list.entries.map((entry) => {
      if (entry.stockId !== stockId) return entry;

      const without = from === null ? entry.topics : entry.topics.filter((name) => name !== from);
      const next = to === null || without.includes(to) ? without : [...without, to];

      return { ...entry, topics: next };
    }),
  };
}

/** 調整題材的顯示順序。索引超出範圍時原樣回傳，不做環繞。 */
export function moveTopicOrder(list: Watchlist, topic: string, toIndex: number): Watchlist {
  const current = list.topics.indexOf(topic);
  if (current === -1 || toIndex < 0 || toIndex >= list.topics.length) return list;

  const topics = [...list.topics];
  topics.splice(current, 1);
  topics.splice(toIndex, 0, topic);

  return { ...list, topics };
}
