import { openDssDatabase } from '../storage/database';
import { emptyProfile, type Profile } from './profile';

/**
 * Profile 存在既有的 settings 資料表，而不是自己開一張。
 *
 * 兩個理由：不必把資料庫版本再往上升（升版的編輯若被 HMR 攔腰套用，
 * 瀏覽器會停在一個永不自癒的半套 schema），以及 settings 本來就在
 * 備份範圍內，備份與還原不必另外改。
 *
 * 鍵名刻意取為 profile：備份會過濾掉含 token／secret 等字樣的設定，
 * 取錯名字會讓 Profile 被默默排除在備份之外。
 */
export const PROFILE_SETTING_KEY = 'profile';

function isProfile(value: unknown): value is Profile {
  if (typeof value !== 'object' || value === null) return false;

  const candidate = value as Partial<Profile>;

  return candidate.version === 1 && typeof candidate.entries === 'object' && candidate.entries !== null;
}

export async function readProfile(): Promise<Profile> {
  const db = await openDssDatabase();

  try {
    const stored = await db.get('settings', PROFILE_SETTING_KEY);

    // 毀損或版本不符時回空的 Profile：寧可什麼都不判定，也不要用壞資料判定
    return isProfile(stored?.value) ? stored.value : emptyProfile();
  } finally {
    db.close();
  }
}

export async function writeProfile(profile: Profile): Promise<void> {
  const db = await openDssDatabase();

  try {
    await db.put('settings', { key: PROFILE_SETTING_KEY, value: profile });
  } finally {
    db.close();
  }
}
