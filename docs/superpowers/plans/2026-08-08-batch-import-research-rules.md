# 研究參數批次帶入 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在「目前規則」頁以一次預覽與一次確認，將建立部位、加碼、再進場各自最新研究的 normal band 批次寫入情境 Profile。

**Architecture:** 新增無副作用的 `batchResearchCandidates` 模組，將已正規化的研究紀錄與目前 Profile 轉成可預覽、可一次寫入的結果。`BatchResearchImportPreview` 只呈現分組差異與確認狀態；`ProfilePage` 負責讀取 IndexedDB、開啟預覽、單次 `writeProfile` 與成敗訊息。

**Tech Stack:** React 19、TypeScript 5.9、IndexedDB/idb、Vitest 4、Testing Library、Vite 7。

## Global Constraints

- 一次處理 `establish`、`add-on`、`reentry` 三種情境，不跨情境借用紀錄。
- 每個情境 × 資產類別 × 指標只取最新研究的 `normal` band。
- 可用候選覆蓋既有研究與手動規則；缺少候選保留原值。
- 所有可用弱證據候選一併納入，但需一次整批勾選確認，並保留證據標記。
- 取消不寫入；確認只呼叫一次 `writeProfile(nextProfile)`；失敗不改 saved Profile。
- 不重新執行研究、不同步市場資料、不改寫交易與歷史研究。
- 保留現有 `src/dss/trend.ts` 與 `src/dss/trend.test.ts` 未提交變更，不納入任何 commit。

---

## File Structure

- Create `src/profile/batchResearchCandidates.ts`: 定義批次預覽類型，選出每個情境最新 run，整理 normal band，分類新增／覆蓋／保留，產生 `nextProfile`。
- Create `src/profile/batchResearchCandidates.test.ts`: 驗證情境隔離、最新紀錄、normal 互斥、最多 26 項、覆蓋、缺漏保留與弱證據標記。
- Create `src/features/profile/BatchResearchImportPreview.tsx`: 三情境預覽對話框、計數、明細、手動覆蓋警示、保留摘要、弱證據全域確認。
- Create `src/features/profile/BatchResearchImportPreview.test.tsx`: 驗證預覽分組、手動警示、弱證據阻擋、取消與確認 callback。
- Modify `src/features/profile/ProfilePage.tsx`: 讀取 research runs、提供批次入口、開啟預覽、單次寫入、成功同步 saved/draft、失敗可重試。
- Modify `src/features/profile/ProfilePage.test.tsx`: 以真實 IndexedDB 資料驗證入口、無候選、三情境寫入、取消不寫與寫入失敗。
- Modify `src/features/profile/ProfilePage.css`: 加入批次入口、情境卡、計數、差異列、可展開保留區與錯誤訊息的密度及行動版型。

### Task 1: 批次候選整理器

**Files:**
- Create: `src/profile/batchResearchCandidates.ts`
- Test: `src/profile/batchResearchCandidates.test.ts`

**Interfaces:**
- Consumes: `ResearchRunRecord[]`, `Profile`, `researchMetricsFor(scenario)`, `applyScenarioCandidate(profile, application)`.
- Produces: `buildBatchResearchImport(runs: ResearchRunRecord[], profile: Profile, appliedAt: string): BatchResearchImport`; `BatchResearchImport`, `BatchScenarioImport`, `BatchCandidateChange`, `BatchPreservedRule`.

- [ ] **Step 1: Write failing tests for scenario selection and candidate limits**

Create a `makeRun` fixture whose `results` provides a normal band for each requested metric and asset class, then assert:

```ts
const batch = buildBatchResearchImport(
  [olderEstablish, latestEstablish, latestAddOn, latestReentry],
  emptyProfile(),
  '2026-08-08T00:00:00.000Z',
);

expect(batch.scenarios.establish.run?.id).toBe(latestEstablish.id);
expect(batch.scenarios['add-on'].changes).toHaveLength(10);
expect(batch.scenarios.reentry.changes).toHaveLength(8);
expect(batch.changes).toHaveLength(26);
expect(batch.changes.every((change) => change.band.band === 'normal')).toBe(true);
```

Also pass a legacy run with no `scenario` and assert it is eligible only for `establish`.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npx.cmd vitest run src/profile/batchResearchCandidates.test.ts`

Expected: FAIL because `batchResearchCandidates` does not exist.

- [ ] **Step 3: Implement the public types and latest-run selection**

Create these exact exported shapes:

```ts
export type BatchChangeKind = 'added' | 'overwritten';

export type BatchCandidateChange = {
  scenario: ResearchScenario;
  assetClass: AssetClass;
  metric: ScenarioResearchMetric;
  kind: BatchChangeKind;
  replacesManual: boolean;
  previous: ProfileEntry;
  next: ProfileEntry;
  band: BandResult;
  runId: string;
};

export type BatchPreservedRule = {
  scenario: ResearchScenario;
  assetClass: AssetClass;
  metric: ScenarioResearchMetric;
  previous: ProfileEntry;
};

export type BatchScenarioImport = {
  scenario: ResearchScenario;
  run: Pick<ResearchRunRecord, 'id' | 'executedAt' | 'eventCount' | 'entryCount' | 'completeCount'> | null;
  changes: BatchCandidateChange[];
  preserved: BatchPreservedRule[];
};

export type BatchResearchImport = {
  scenarios: Record<ResearchScenario, BatchScenarioImport>;
  changes: BatchCandidateChange[];
  preserved: BatchPreservedRule[];
  hasWeakEvidence: boolean;
  nextProfile: Profile;
};
```

Use `['establish', 'add-on', 'reentry'] as const` and select the first matching run after sorting a copy by descending `executedAt`; normalize `run.scenario ?? 'establish'` locally so direct test fixtures and restored legacy data are safe.

- [ ] **Step 4: Implement candidate extraction and immutable Profile application**

For every `scenario`, `assetClass`, and `researchMetricsFor(scenario)` key:

```ts
const results = run?.results as Partial<
  Record<ScenarioResearchMetric, Partial<Record<AssetClass, WalkForwardResult>>>
> | undefined;
const result = results?.[metric]?.[assetClass];
const band = result?.bands.find((item) => item.band === 'normal');
const available = band !== undefined
  && Number.isFinite(band.range.min)
  && Number.isFinite(band.range.max);
```

When unavailable, append a `BatchPreservedRule` using `readScenarioEntry`. When available, call `applyScenarioCandidate` with `despiteWeakEvidence: band.evidence !== 'worth-tracking'` and `at: appliedAt`; classify as `added` only when both old boundaries are null, otherwise `overwritten`, and set `replacesManual` when either old boundary has `origin === 'manual'`.

- [ ] **Step 5: Add failing tests for overwrite, preservation, and weak evidence**

Start from a Profile containing one manual entry and one candidate entry. Assert that available normal bands replace both boundaries and provenance, while missing result, missing normal band, null bound, `NaN`, and `Infinity` preserve the exact previous entry. Assert weak evidence sets both new boundaries' `appliedDespiteWeakEvidence` to `true` and makes `batch.hasWeakEvidence` true.

- [ ] **Step 6: Run data tests and verify GREEN**

Run: `npx.cmd vitest run src/profile/batchResearchCandidates.test.ts src/profile/profile.test.ts`

Expected: both files PASS.

- [ ] **Step 7: Commit the data slice**

```powershell
git add -- src/profile/batchResearchCandidates.ts src/profile/batchResearchCandidates.test.ts
git commit -m "feat: 整理三情境最新研究參數"
```

### Task 2: 批次預覽與全域弱證據確認

**Files:**
- Create: `src/features/profile/BatchResearchImportPreview.tsx`
- Test: `src/features/profile/BatchResearchImportPreview.test.tsx`
- Modify: `src/features/profile/ProfilePage.css`

**Interfaces:**
- Consumes: `BatchResearchImport`; `SCENARIO_LABEL`, `METRIC_LABEL`, `METRIC_UNIT`, `ASSET_LABEL`, `EVIDENCE_LABEL`, `EVIDENCE_TONE`.
- Produces: `BatchResearchImportPreview({ batch, saving, error, onCancel, onConfirm })` where callbacks are `() => void` and confirming is disabled while `saving` or while weak evidence is unacknowledged.

- [ ] **Step 1: Write the failing interaction tests**

Render a batch containing all three scenario groups, an overwritten manual rule, a preserved rule, and one weak candidate. Assert the dialog contains `建立部位`, `加碼`, `再進場`, run date/sample summary, `覆蓋手動規則`, old/new boundary text, evidence label, and preserved count. Assert `整批套用` is disabled until the acknowledgement checkbox is selected.

```ts
expect(screen.getByRole('button', { name: '整批套用' })).toBeDisabled();
await userEvent.click(screen.getByRole('checkbox', { name: /未通過驗證/ }));
await userEvent.click(screen.getByRole('button', { name: '整批套用' }));
expect(onConfirm).toHaveBeenCalledTimes(1);
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npx.cmd vitest run src/features/profile/BatchResearchImportPreview.test.tsx`

Expected: FAIL because the preview component does not exist.

- [ ] **Step 3: Implement grouped preview rendering**

Use the existing `.apply` dialog pattern. For each scenario, render the run timestamp plus `eventCount ?? entryCount` and `completeCount`, then summary badges for `added`, `overwritten`, and `preserved`. Render each change with previous/new lower and upper values, asset/metric labels, evidence badge, reason, and a dedicated `覆蓋手動規則` warning when `replacesManual` is true. Put preserved rows under native `<details>` so they are collapsed by default and still keyboard accessible.

- [ ] **Step 4: Implement one global acknowledgement and retry-safe actions**

Store `acknowledged` locally and calculate:

```ts
const blocked = saving || (batch.hasWeakEvidence && !acknowledged);
```

Show the checkbox only for weak evidence. Display `error` with `role="alert"`; keep cancel and confirm present, change confirm copy to `套用中…` while saving, and do not mutate `batch.nextProfile` in the component.

- [ ] **Step 5: Add dense responsive styles**

Add `.batch-import*` rules to `ProfilePage.css`: a bordered action panel, three scenario blocks, compact count row, two-column before/after values on wide screens, single-column rows below `720px`, attention styling for manual overwrite and weak evidence, and visible focus states inherited from `.btn`/native controls.

- [ ] **Step 6: Run component tests and verify GREEN**

Run: `npx.cmd vitest run src/features/profile/BatchResearchImportPreview.test.tsx`

Expected: PASS for grouped content, global acknowledgement, cancel, confirm, saving, and error cases.

- [ ] **Step 7: Commit the preview slice**

```powershell
git add -- src/features/profile/BatchResearchImportPreview.tsx src/features/profile/BatchResearchImportPreview.test.tsx src/features/profile/ProfilePage.css
git commit -m "feat: 新增研究參數批次預覽"
```

### Task 3: 規則頁串接、單次寫入與回歸驗證

**Files:**
- Modify: `src/features/profile/ProfilePage.tsx`
- Modify: `src/features/profile/ProfilePage.test.tsx`
- Modify: `src/features/profile/ProfilePage.css`

**Interfaces:**
- Consumes: `readResearchRuns(): Promise<ResearchRunRecord[]>`; `buildBatchResearchImport(runs, profile, appliedAt)`; `BatchResearchImportPreview`; `writeProfile(profile): Promise<void>`.
- Produces: 「從最新研究一次帶入」頁面入口、無候選訊息、成功訊息與可重試失敗狀態。

- [ ] **Step 1: Write failing integration tests using IndexedDB**

Seed three `ResearchRunRecord`s through `openDssDatabase()` and a Profile with one manual rule. Assert clicking `從最新研究一次帶入` opens the preview; acknowledging weak evidence and confirming closes it; `readProfile()` then contains establish/add-on/reentry entries and the active table updates immediately. Cancel a second preview and assert the stored Profile is unchanged.

- [ ] **Step 2: Add failing tests for no candidate and write failure**

With no research records, click the entry and assert `目前沒有可帶入的研究參數` appears and no dialog opens. Mock `writeProfile` to reject once; assert the preview remains open, `role="alert"` is shown, the saved table is unchanged, and a second click can retry.

- [ ] **Step 3: Run the page test and verify RED**

Run: `npx.cmd vitest run src/features/profile/ProfilePage.test.tsx`

Expected: FAIL because the page has no batch-import entry or integration.

- [ ] **Step 4: Load research runs and create previews without writing**

Add state:

```ts
const [runs, setRuns] = useState<ResearchRunRecord[] | null>(null);
const [batch, setBatch] = useState<BatchResearchImport | null>(null);
const [batchMessage, setBatchMessage] = useState<string | null>(null);
const [batchSaving, setBatchSaving] = useState(false);
const [batchError, setBatchError] = useState<string | null>(null);
```

Load `readProfile()` and `readResearchRuns()` together in the existing mount flow. The entry button calls `buildBatchResearchImport(runs ?? [], saved, new Date().toISOString())`; if `changes.length === 0`, set the no-candidate message, otherwise store the batch and clear prior error/message. Use `saved`, not unsaved `draft`, so pending manual edits cannot be silently combined with a batch overwrite.

- [ ] **Step 5: Implement one write and consistent success/failure state**

Confirm with an awaited handler:

```ts
setBatchSaving(true);
setBatchError(null);
try {
  await writeProfile(batch.nextProfile);
  setSaved(batch.nextProfile);
  setDraft(batch.nextProfile);
  setBatch(null);
  setBatchMessage(`已帶入 ${batch.changes.length} 組研究參數。`);
} catch {
  setBatchError('套用失敗，已保留原規則，請再試一次。');
} finally {
  setBatchSaving(false);
}
```

Disable the batch entry while `dirty` and explain `請先儲存或捨棄目前調整`，避免批次覆蓋與未儲存手動編輯競爭。

- [ ] **Step 6: Run page and adjacent regression tests**

Run: `npx.cmd vitest run src/features/profile/ProfilePage.test.tsx src/features/profile/BatchResearchImportPreview.test.tsx src/profile/batchResearchCandidates.test.ts src/features/research/ResearchPage.test.tsx src/features/today/TodayPage.test.tsx`

Expected: all selected files PASS.

- [ ] **Step 7: Run full verification**

Run in order:

```powershell
npx.cmd vitest run --exclude '.worktrees/**'
npm.cmd run test:worker
npm.cmd run typecheck
npm.cmd run build
```

Expected: every command exits 0; Vite prints a completed production build, not only transformed-module counts.

- [ ] **Step 8: Inspect the UI in a fresh local page**

Open the local Vite page, navigate to `目前規則`, and verify the batch entry, three scenario summaries, collapsed preserved rows, weak-evidence acknowledgement, manual-overwrite warning, responsive layout, successful apply message, and zero console errors. Do not trigger research, market sync, push, merge, or deployment.

- [ ] **Step 9: Commit the integration slice**

```powershell
git add -- src/features/profile/ProfilePage.tsx src/features/profile/ProfilePage.test.tsx src/features/profile/ProfilePage.css
git commit -m "feat: 一次帶入三情境研究規則"
```

- [ ] **Step 10: Confirm repository scope**

Run `git status --short` and `git log -4 --oneline`. Expected: only the pre-existing `src/dss/trend.ts` and `src/dss/trend.test.ts` remain dirty; the plan plus three feature slices are committed locally, with no push or merge performed.
