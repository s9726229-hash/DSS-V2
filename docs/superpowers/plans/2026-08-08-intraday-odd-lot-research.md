# 盤中零股納入情境研究 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 讓盤中零股現股交易可靠地進入建立部位、加碼與再進場研究，修正情境文案，並以使用者提供的 CSV 補齊本機資料後重新驗證。

**Architecture:** 在 `positionLedger` 的交易方式邊界明確接受 `普通`與`盤中零股`，保留所有其他排除規則。研究頁只依目前 `ResearchScenario` 取得文案，不改研究計算；資料中心只修正文案，沿用既有預覽、確認與補欄位流程。

**Tech Stack:** React 19、TypeScript 5.9、Vitest 4、Testing Library、IndexedDB/idb、Vite 7。

## Global Constraints

- `盤中零股`與`普通`同樣可納入；`盤後零股`、`定期定額`、未知方式、`現沖`與非現股維持排除。
- 情境仍由交易前持倉判定；不修改成本公式、觀察窗、證據門檻或 Profile 確認流程。
- 原始 CSV 只進入本機 IndexedDB，不寫入 Git，不輸出個人交易明細。
- 回補失敗或來源缺漏必須明確回報，不得推測或補造資料。
- 不推送、合併或部署 `codex/v1-information-architecture`。

---

### Task 1: 讓盤中零股進入可靠情境帳本

**Files:**
- Modify: `src/research/positionLedger.ts:87-92`
- Test: `src/research/positionLedger.test.ts:34-162`

**Interfaces:**
- Consumes: `StoredTransaction.tradeMethod`、`buildResearchLedger()`、`selectLedgerEvents()`。
- Produces: `methodIssue()` 將 `盤中零股`視為無排除原因；事件仍以既有 `ResearchScenario` 輸出。

- [ ] **Step 1: 新增建立部位紅燈測試**

```ts
it('盤中零股在持倉為零時納入建立部位研究', () => {
  const ledger = buildResearchLedger({
    transactions: [tx({ tradeMethod: '盤中零股', quantity: 50 })],
    splitsByStock: splits(),
  });

  expect(selectLedgerEvents(ledger, 'establish')).toHaveLength(1);
  expect(selectLedgerEvents(ledger, 'establish')[0]).toMatchObject({
    scenario: 'establish',
    positionBefore: 0,
    positionAfter: 50,
    includeInScenarioResearch: true,
  });
});
```

- [ ] **Step 2: 新增加碼與再進場紅燈測試**

```ts
it('盤中零股依持倉分別成為加碼與再進場', () => {
  const ledger = buildResearchLedger({
    transactions: [
      tx({ quantity: 100, price: 100 }),
      tx({ tradeDate: '2026-01-05', tradeMethod: '盤中零股', quantity: 50, price: 90 }),
      tx({ tradeDate: '2026-01-08', side: 'sell', quantity: 150, price: 110 }),
      tx({ tradeDate: '2026-01-12', tradeMethod: '盤中零股', quantity: 20, price: 80 }),
    ],
    splitsByStock: splits(),
  });

  expect(selectLedgerEvents(ledger, 'add-on')[0]).toMatchObject({
    scenario: 'add-on',
    averageCostBefore: 100,
    relativeCostPercent: -10,
    includeInScenarioResearch: true,
  });
  expect(selectLedgerEvents(ledger, 'reentry')[0]).toMatchObject({
    scenario: 'reentry',
    positionBefore: 0,
    includeInScenarioResearch: true,
  });
});
```

- [ ] **Step 3: 執行紅燈測試**

Run: `npx.cmd vitest run src/research/positionLedger.test.ts`

Expected: 新增測試因事件仍含 `trade-method-unknown` 而失敗。

- [ ] **Step 4: 實作最小交易方式判定**

```ts
function methodIssue(row: StoredTransaction): LedgerIssueCode | null {
  const method = row.tradeMethod?.trim();
  if (method === '普通' || method === '盤中零股') return null;
  if (method?.includes('定期定額')) return 'scheduled-investment';
  return 'trade-method-unknown';
}
```

- [ ] **Step 5: 執行綠燈與既有排除測試**

Run: `npx.cmd vitest run src/research/positionLedger.test.ts`

Expected: 全部通過；既有 `盤後零股`、`定期定額`、未知方式與非現股測試保持通過。

- [ ] **Step 6: 提交帳本規則**

```powershell
git add -- src/research/positionLedger.ts src/research/positionLedger.test.ts
git commit -m "feat: 納入盤中零股情境研究"
```

### Task 2: 讓歷史研究文案隨情境切換

**Files:**
- Modify: `src/features/research/ResearchPage.tsx:39-55,365-470`
- Test: `src/features/research/ResearchPage.test.tsx:88-120`

**Interfaces:**
- Consumes: `ResearchScenario` 與 `scenario` React state。
- Produces: `SCENARIO_COPY`，提供頁首摘要、樣本標籤、空資料提示與缺資料名詞。

- [ ] **Step 1: 新增加碼情境紅燈測試**

```ts
it('切到加碼研究後摘要與空資料提示改用加碼文案', async () => {
  render(<ResearchPage />);
  await userEvent.click(await screen.findByRole('tab', { name: '加碼研究' }));

  const inventory = await screen.findByRole('region', { name: '研究樣本' });
  expect(within(inventory).getByText('加碼')).toBeInTheDocument();
  expect(screen.getByText(/研究期間內沒有加碼/)).toBeInTheDocument();
  expect(screen.getByText(/分析 2026 年起的加碼交易/)).toBeInTheDocument();
  expect(screen.queryByText(/加碼、再進場與現沖不列入本輪分析/)).not.toBeInTheDocument();
});
```

- [ ] **Step 2: 新增再進場情境紅燈測試**

```ts
it('切到再進場研究後摘要與空資料提示改用再進場文案', async () => {
  render(<ResearchPage />);
  await userEvent.click(await screen.findByRole('tab', { name: '再進場研究' }));

  const inventory = await screen.findByRole('region', { name: '研究樣本' });
  expect(within(inventory).getByText('再進場')).toBeInTheDocument();
  expect(screen.getByText(/研究期間內沒有再進場/)).toBeInTheDocument();
  expect(screen.getByText(/分析 2026 年起的再進場交易/)).toBeInTheDocument();
});
```

- [ ] **Step 3: 執行紅燈測試**

Run: `npx.cmd vitest run src/features/research/ResearchPage.test.tsx`

Expected: 測試找不到情境化摘要與樣本標籤。

- [ ] **Step 4: 新增集中情境文案並套用**

```ts
const SCENARIO_COPY: Record<ResearchScenario, {
  sampleLabel: string;
  summary: string;
  empty: string;
  missing: string;
}> = {
  establish: {
    sampleLabel: '建立部位',
    summary: '分析 2026 年起的建立部位在買進當日的條件，以及買進後的實際結果。',
    empty: '研究期間內沒有建立部位。',
    missing: '這些建立部位無法分析。',
  },
  'add-on': {
    sampleLabel: '加碼',
    summary: '分析 2026 年起的加碼交易在成交當日的條件，以及加碼後的實際結果。',
    empty: '研究期間內沒有加碼。',
    missing: '這些加碼交易無法分析。',
  },
  reentry: {
    sampleLabel: '再進場',
    summary: '分析 2026 年起的再進場交易在成交當日的條件，以及再進場後的實際結果。',
    empty: '研究期間內沒有再進場。',
    missing: '這些再進場交易無法分析。',
  },
};
```

在 render 前設定 `const copy = SCENARIO_COPY[scenario]`，並以 `copy.summary`、`copy.sampleLabel`、`copy.empty`、`copy.missing`取代靜態建立部位文字；保留 2025 年只供查閱與不自動套用說明。

- [ ] **Step 5: 執行綠燈測試**

Run: `npx.cmd vitest run src/features/research/ResearchPage.test.tsx`

Expected: 全部通過。

- [ ] **Step 6: 提交情境文案**

```powershell
git add -- src/features/research/ResearchPage.tsx src/features/research/ResearchPage.test.tsx
git commit -m "fix: 對齊歷史研究情境文案"
```

### Task 3: 說明重匯會補齊交易種類

**Files:**
- Modify: `src/features/data-center/ImportPanel.tsx:39-46`
- Test: `src/features/data-center/DataCenterPage.test.tsx:79-115`

**Interfaces:**
- Consumes: 既有 `COPY.transactions.description` 與資料中心畫面。
- Produces: 與 `planTransactionImport()`／`importTransactions()` 行為一致的可見說明。

- [ ] **Step 1: 新增文案紅燈測試**

```ts
it('交易匯入說明指出重匯可補齊交易種類', () => {
  renderPage();
  const panel = screen.getByRole('region', { name: '匯入交易明細' });
  expect(within(panel).getByText(/既有交易不會重複新增.*補齊.*交易種類/)).toBeInTheDocument();
});
```

- [ ] **Step 2: 執行紅燈測試**

Run: `npx.cmd vitest run src/features/data-center/DataCenterPage.test.tsx`

Expected: 找不到新說明。

- [ ] **Step 3: 修改最小文案**

```ts
description: '券商匯出的成交明細。重匯相同檔案時，既有交易不會重複新增，並可補齊舊紀錄缺少的交易種類。',
```

- [ ] **Step 4: 執行綠燈測試**

Run: `npx.cmd vitest run src/features/data-center/DataCenterPage.test.tsx`

Expected: 全部通過，包括既有補齊 1 筆交易方式的整合測試。

- [ ] **Step 5: 提交匯入說明**

```powershell
git add -- src/features/data-center/ImportPanel.tsx src/features/data-center/DataCenterPage.test.tsx
git commit -m "docs: 說明交易重匯補齊行為"
```

### Task 4: 更新版本規格並執行完整驗證

**Files:**
- Modify: `V2_CURRENT_REQUIREMENTS.md`
- Modify: `VERSION_LOG.md`

**Interfaces:**
- Consumes: 已驗證的盤中零股規則與情境文案。
- Produces: 不含個人交易明細的 V2 規格與版本紀錄。

- [ ] **Step 1: 更新客觀規格**

在交易方式規則中記錄：`普通`與`盤中零股`可成為主動情境樣本；`定期定額`、`盤後零股`、未知方式、現沖與非現股排除。版本紀錄只寫規則與驗證結果，不寫個人股票、日期、數量或價格。

- [ ] **Step 2: 執行完整前端測試**

Run: `npx.cmd vitest run`

Expected: 46 個以上測試檔全部通過，0 failed。

- [ ] **Step 3: 執行 Worker 測試**

Run: `npm.cmd run test:worker`

Expected: 52 項全部通過。

- [ ] **Step 4: 執行型別檢查**

Run: `npm.cmd run typecheck`

Expected: exit 0，無 TypeScript 錯誤。

- [ ] **Step 5: 使用 bundled Node 正式建置**

Run: `& 'C:\Users\USER\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' 'node_modules/vite/bin/vite.js' build`

Expected: exit 0，產出 HTML、CSS、JavaScript 與 gzip 摘要；不能只以 transformed modules 判定成功。

- [ ] **Step 6: 提交規格與驗證紀錄**

```powershell
git add -- V2_CURRENT_REQUIREMENTS.md VERSION_LOG.md
git commit -m "docs: 記錄盤中零股研究驗證"
```

### Task 5: 本機重匯、拆股回補與瀏覽器驗收

**Files:**
- No repository files modified。
- Local input: `C:\Users\USER\Desktop\財務管理\股票交易明細\全部交易歷史.CSV`

**Interfaces:**
- Consumes: 資料中心的匯入預覽／確認流程、`prepareResearchLedgerData()`、三個研究情境頁面。
- Produces: 補齊後的本機 IndexedDB、拆股覆蓋與只含彙總的驗收結果。

- [ ] **Step 1: 開啟 V2 資料中心並選擇 CSV**

透過本機 `http://127.0.0.1:5174/` 的「資料中心 → 選擇交易明細檔案」選取來源 CSV。只讀取本機檔案，不把原始 CSV 寫入專案或傳到第三方。

- [ ] **Step 2: 核對匯入預覽後才寫入**

確認預覽中的「新增、補齊交易方式、已存在」合計等於解析成功交易筆數。若資料庫仍包含來源檔所有交易，新增應為 0；若新增不為 0，先停止並回報差異，不直接確認匯入。補齊筆數可隨目前 IndexedDB 狀態變動，不硬編預期值。

- [ ] **Step 3: 確認本機補齊**

確認匯入後交易總數沒有因重匯而重複增加，並記錄仍缺交易方式的彙總數。來源 CSV 未包含的更早交易維持缺漏，不推測其交易種類。

- [ ] **Step 4: 執行歷史資料回補**

在歷史研究按「回補歷史資料」。此動作透過既有 Worker 向 FinMind 查詢帳本需要的股票與日期範圍；只回報請求數、成功／失敗數與失敗原因，不輸出個股明細。

- [ ] **Step 5: 驗收三種情境與預計加碼價**

切換建立部位、加碼研究、再進場研究，確認情境文案正確、盤中零股不再顯示交易方式不明、排除摘要下降。對成本可靠的目前持倉確認預計加碼價試算出現，且重新載入後不保留輸入。

- [ ] **Step 6: 檢查瀏覽器錯誤並保留畫面**

確認瀏覽器 console 0 errors；將頁面停留在加碼研究供使用者複驗。若仍無可靠樣本，回報剩餘的期初部位、同日反向、拆股或來源範圍缺漏，不宣稱研究已可採用。
