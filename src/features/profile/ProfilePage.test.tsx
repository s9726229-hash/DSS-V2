import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { deleteDB } from 'idb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as profileStore from '../../profile/profileStore';
import { readScenarioEntry } from '../../profile/profile';
import {
  researchMetricsFor,
  type ResearchMetric,
  type ResearchScenario,
  type ScenarioResearchMetric,
} from '../../research/runResearch';
import type { AssetClass } from '../../research/snapshot';
import type { BandResult, WalkForwardResult } from '../../research/walkForward';
import { DATABASE_NAME, openDssDatabase } from '../../storage/database';
import type { ResearchRunRecord } from '../../storage/types';
import { ProfilePage } from './ProfilePage';

beforeEach(async () => {
  vi.restoreAllMocks();
  await deleteDB(DATABASE_NAME);
});

function normalBand(): BandResult {
  return {
    band: 'normal',
    range: { min: -2, max: 3 },
    completeCount: 12,
    nonOverlappingCount: 10,
    median: 2,
    mean: 1,
    worst: -5,
    positiveCount: 7,
    negativeCount: 5,
    checkpointsCovered: 2,
    baselineMedian: 0,
    nonOverlappingMedian: 2,
    flippedCount: 0,
    stableCount: 12,
    stableMedian: 2,
    cleanCount: 10,
    evidence: 'worth-tracking',
    reason: '虛構候選已通過驗證。',
  };
}

function walkForward(assetClass: AssetClass): WalkForwardResult {
  return {
    assetClass,
    checkpoints: [],
    drift: { p25: null, p75: null },
    bands: [normalBand()],
    baseline: {
      completeCount: 12,
      nonOverlappingCount: 10,
      median: 0,
      mean: 0,
      worst: -8,
      positiveCount: 6,
      negativeCount: 6,
    },
  };
}

function researchRun(scenario: ResearchScenario, day: string): ResearchRunRecord {
  const results: Partial<
    Record<ScenarioResearchMetric, Record<AssetClass, WalkForwardResult>>
  > = {};
  for (const metric of researchMetricsFor(scenario)) {
    results[metric] = { stock: walkForward('stock'), etf: walkForward('etf') };
  }

  return {
    id: `run:${scenario}`,
    executedAt: `${day}T08:00:00.000Z`,
    signature: `signature:${scenario}`,
    scenario,
    eventCount: 18,
    entryCount: 18,
    technicalCount: 17,
    chipCount: 16,
    completeCount: 15,
    results: results as Record<ResearchMetric, Record<AssetClass, WalkForwardResult>>,
  };
}

async function seedRuns(runs: ResearchRunRecord[]) {
  const db = await openDssDatabase();
  try {
    const transaction = db.transaction('researchRuns', 'readwrite');
    for (const run of runs) await transaction.store.put(run);
    await transaction.done;
  } finally {
    db.close();
  }
}

describe('情境 Profile', () => {
  it('三個情境分開切換，只有加碼顯示相對均價', async () => {
    render(<ProfilePage />);
    expect(await screen.findByRole('tab', { name: '建立部位' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByText('相對均價')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('tab', { name: '加碼' }));

    expect(screen.getAllByText('相對均價').length).toBeGreaterThan(0);
    expect(screen.getByRole('tab', { name: '加碼' })).toHaveAttribute('aria-selected', 'true');
  });

  it('取消批次預覽不寫入，確認後一次帶入三個情境', async () => {
    await seedRuns([
      researchRun('establish', '2026-08-07'),
      researchRun('add-on', '2026-08-06'),
      researchRun('reentry', '2026-08-05'),
    ]);
    render(<ProfilePage />);

    const open = await screen.findByRole('button', { name: '從最新研究一次帶入' });
    await userEvent.click(open);
    expect(screen.getByRole('dialog', { name: '批次帶入研究參數' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '取消' }));
    expect((await profileStore.readProfile()).scenarioEntries).toBeUndefined();

    await userEvent.click(open);
    await userEvent.click(screen.getByRole('button', { name: '整批套用' }));

    expect(await screen.findByText('已帶入 26 組研究參數。')).toBeInTheDocument();
    const stored = await profileStore.readProfile();
    expect(readScenarioEntry(stored, 'establish', 'stock', 'bias20').lower?.value).toBe(-2);
    expect(readScenarioEntry(stored, 'add-on', 'etf', 'relativeCost').upper?.value).toBe(3);
    expect(readScenarioEntry(stored, 'reentry', 'stock', 'marginFlow').upper?.value).toBe(3);

    await userEvent.click(screen.getByRole('tab', { name: '加碼' }));
    expect(screen.getAllByDisplayValue('-2.00').length).toBeGreaterThan(0);
  });

  it('沒有可用候選時顯示說明，不開啟空白預覽', async () => {
    render(<ProfilePage />);

    await userEvent.click(
      await screen.findByRole('button', { name: '從最新研究一次帶入' }),
    );

    expect(screen.getByText('目前沒有可帶入的研究參數')).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: '批次帶入研究參數' })).not.toBeInTheDocument();
  });

  it('有未儲存手動調整時停用批次帶入，避免靜默覆蓋', async () => {
    await seedRuns([researchRun('establish', '2026-08-07')]);
    render(<ProfilePage />);

    const open = await screen.findByRole('button', { name: '從最新研究一次帶入' });
    const firstBoundary = screen.getAllByRole('textbox', { name: '門檻值' })[0];
    await userEvent.type(firstBoundary, '-5');
    await userEvent.tab();

    expect(open).toBeDisabled();
    expect(screen.getByText('請先儲存或捨棄目前調整，再執行批次帶入。')).toBeInTheDocument();
  });

  it('批次寫入失敗時保留原規則與預覽，並可再試', async () => {
    await seedRuns([researchRun('establish', '2026-08-07')]);
    const originalWrite = profileStore.writeProfile;
    const write = vi
      .spyOn(profileStore, 'writeProfile')
      .mockRejectedValueOnce(new Error('disk full'))
      .mockImplementation(originalWrite);
    render(<ProfilePage />);

    await userEvent.click(
      await screen.findByRole('button', { name: '從最新研究一次帶入' }),
    );
    await userEvent.click(screen.getByRole('button', { name: '整批套用' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('套用失敗');
    expect(screen.getByRole('dialog', { name: '批次帶入研究參數' })).toBeInTheDocument();
    expect((await profileStore.readProfile()).scenarioEntries).toBeUndefined();

    await userEvent.click(screen.getByRole('button', { name: '整批套用' }));
    await waitFor(() => expect(write).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('已帶入 8 組研究參數。')).toBeInTheDocument();
  });
});
