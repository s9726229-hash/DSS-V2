import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { BandResult } from '../../research/walkForward';
import type {
  BatchCandidateChange,
  BatchResearchImport,
} from '../../profile/batchResearchCandidates';
import type { ProfileBoundary, ProfileEntry } from '../../profile/profile';
import { emptyProfile } from '../../profile/profile';
import { BatchResearchImportPreview } from './BatchResearchImportPreview';

function boundary(
  value: number,
  origin: ProfileBoundary['origin'],
): ProfileBoundary {
  return {
    value,
    origin,
    sourceRunId: origin === 'manual' ? null : 'run:old',
    sourceEvidence: origin === 'manual' ? null : 'worth-tracking',
    appliedDespiteWeakEvidence: false,
    updatedAt: '2026-08-01T00:00:00.000Z',
  };
}

function weakBand(): BandResult {
  return {
    band: 'normal',
    range: { min: -2, max: 3 },
    completeCount: 7,
    nonOverlappingCount: 6,
    median: 2,
    mean: 1,
    worst: -5,
    positiveCount: 4,
    negativeCount: 3,
    checkpointsCovered: 1,
    baselineMedian: 0,
    nonOverlappingMedian: 2,
    flippedCount: 0,
    stableCount: 7,
    stableMedian: 2,
    cleanCount: 6,
    evidence: 'preliminary',
    reason: '只有 7 筆完整事件，目前是初步觀察。',
  };
}

function changedEntry(): ProfileEntry {
  return {
    lower: {
      ...boundary(-2, 'candidate'),
      sourceRunId: 'run:establish',
      sourceEvidence: 'preliminary',
      appliedDespiteWeakEvidence: true,
      updatedAt: '2026-08-08T00:00:00.000Z',
    },
    upper: {
      ...boundary(3, 'candidate'),
      sourceRunId: 'run:establish',
      sourceEvidence: 'preliminary',
      appliedDespiteWeakEvidence: true,
      updatedAt: '2026-08-08T00:00:00.000Z',
    },
  };
}

function batch(hasWeakEvidence = true): BatchResearchImport {
  const previous: ProfileEntry = {
    lower: boundary(-9, 'manual'),
    upper: boundary(9, 'manual'),
  };
  const change: BatchCandidateChange = {
    scenario: 'establish',
    assetClass: 'stock',
    metric: 'bias20',
    kind: 'overwritten',
    replacesManual: true,
    previous,
    next: changedEntry(),
    band: hasWeakEvidence
      ? weakBand()
      : { ...weakBand(), evidence: 'worth-tracking', reason: '已通過驗證。' },
    runId: 'run:establish',
  };
  const preserved = {
    scenario: 'establish' as const,
    assetClass: 'etf' as const,
    metric: 'foreignFlow' as const,
    previous: { lower: null, upper: null },
  };

  return {
    scenarios: {
      establish: {
        scenario: 'establish',
        run: {
          id: 'run:establish',
          executedAt: '2026-08-07T08:30:00.000Z',
          eventCount: 18,
          entryCount: 18,
          completeCount: 15,
        },
        changes: [change],
        preserved: [preserved],
      },
      'add-on': {
        scenario: 'add-on',
        run: null,
        changes: [],
        preserved: [],
      },
      reentry: {
        scenario: 'reentry',
        run: {
          id: 'run:reentry',
          executedAt: '2026-08-06T08:30:00.000Z',
          eventCount: 5,
          entryCount: 5,
          completeCount: 4,
        },
        changes: [],
        preserved: [],
      },
    },
    changes: [change],
    preserved: [preserved],
    hasWeakEvidence,
    nextProfile: emptyProfile(),
  };
}

describe('BatchResearchImportPreview', () => {
  it('顯示三情境、研究摘要、覆蓋內容與保留計數', () => {
    render(
      <BatchResearchImportPreview
        batch={batch()}
        saving={false}
        error={null}
        onCancel={() => undefined}
        onConfirm={() => undefined}
      />,
    );

    expect(screen.getByRole('heading', { name: '建立部位' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '加碼' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '再進場' })).toBeInTheDocument();
    expect(screen.getByText(/18 筆事件/)).toBeInTheDocument();
    expect(screen.getByText(/15 筆完整樣本/)).toBeInTheDocument();
    expect(screen.getByText('沒有研究紀錄')).toBeInTheDocument();
    expect(screen.getByText('覆蓋手動規則')).toBeInTheDocument();
    expect(screen.getByText('-9.00 ～ 9.00%')).toBeInTheDocument();
    expect(screen.getByText('-2.00 ～ 3.00%')).toBeInTheDocument();
    expect(screen.getByText('初步觀察')).toBeInTheDocument();
    expect(screen.getByText('無新候選，保留 1 組現有規則')).toBeInTheDocument();
  });

  it('整批含弱證據時，只需一次勾選才能確認', async () => {
    const onConfirm = vi.fn();
    render(
      <BatchResearchImportPreview
        batch={batch()}
        saving={false}
        error={null}
        onCancel={() => undefined}
        onConfirm={onConfirm}
      />,
    );

    const confirm = screen.getByRole('button', { name: '整批套用' });
    expect(confirm).toBeDisabled();

    await userEvent.click(screen.getByRole('checkbox', { name: /未通過驗證/ }));
    await userEvent.click(confirm);

    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('無弱證據時可直接確認，取消、錯誤與儲存中狀態都可見', async () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    const { rerender } = render(
      <BatchResearchImportPreview
        batch={batch(false)}
        saving={false}
        error="套用失敗，已保留原規則。"
        onCancel={onCancel}
        onConfirm={onConfirm}
      />,
    );

    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('套用失敗');
    await userEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();

    rerender(
      <BatchResearchImportPreview
        batch={batch(false)}
        saving
        error={null}
        onCancel={onCancel}
        onConfirm={onConfirm}
      />,
    );
    expect(screen.getByRole('button', { name: '套用中…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '取消' })).toBeDisabled();
  });
});
