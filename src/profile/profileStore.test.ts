import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { openDssDatabase } from '../storage/database';
import { applyCandidate, emptyProfile, readEntry } from './profile';
import { PROFILE_SETTING_KEY, readProfile, writeProfile } from './profileStore';

async function clearSettings() {
  const db = await openDssDatabase();
  try {
    await db.clear('settings');
  } finally {
    db.close();
  }
}

const AT = '2026-08-01T00:00:00.000Z';

function withThreshold() {
  return applyCandidate(emptyProfile(), {
    assetClass: 'stock',
    metric: 'bias20',
    band: 'normal',
    range: { min: -1.5, max: 15.78 },
    runId: 'run:test',
    evidence: 'worth-tracking',
    despiteWeakEvidence: false,
    at: AT,
  });
}

beforeEach(async () => {
  await clearSettings();
});

describe('Profile 儲存', () => {
  it('尚未儲存過時回傳空的 Profile，而不是 null', async () => {
    expect(await readProfile()).toEqual(emptyProfile());
  });

  it('寫入後讀得回完整內容', async () => {
    await writeProfile(withThreshold());

    const entry = readEntry(await readProfile(), 'stock', 'bias20');

    expect(entry.lower?.value).toBe(-1.5);
    expect(entry.upper?.value).toBe(15.78);
    expect(entry.lower?.sourceRunId).toBe('run:test');
  });

  it('再次寫入會取代前一份，不會累積成多筆', async () => {
    await writeProfile(withThreshold());
    await writeProfile(emptyProfile());

    const db = await openDssDatabase();
    try {
      expect(await db.count('settings')).toBe(1);
    } finally {
      db.close();
    }

    expect(await readProfile()).toEqual(emptyProfile());
  });

  /** 存進 settings 是為了搭上既有備份；鍵名不可含 token 等字樣，否則會被備份的敏感字過濾掉。 */
  it('使用不會被備份敏感字過濾掉的鍵名', () => {
    expect(PROFILE_SETTING_KEY).toBe('profile');
    expect(/token|secret|password|apikey|api_key|credential/i.test(PROFILE_SETTING_KEY)).toBe(
      false,
    );
  });

  it('儲存內容毀損時回傳空的 Profile，不讓壞資料流進判定', async () => {
    const db = await openDssDatabase();
    try {
      await db.put('settings', { key: PROFILE_SETTING_KEY, value: 'not a profile' });
    } finally {
      db.close();
    }

    expect(await readProfile()).toEqual(emptyProfile());
  });

  it('版本不符時回傳空的 Profile', async () => {
    const db = await openDssDatabase();
    try {
      await db.put('settings', { key: PROFILE_SETTING_KEY, value: { version: 99, entries: {} } });
    } finally {
      db.close();
    }

    expect(await readProfile()).toEqual(emptyProfile());
  });
});
