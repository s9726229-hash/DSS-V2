import type { ResearchMetric } from '../research/runResearch';
import type { AssetClass } from '../research/snapshot';
import type { BandId, EvidenceLevel } from '../research/walkForward';

/**
 * 個人 Profile。
 *
 * 三個候選區間其實只由兩個數字切出來（訓練期的 P25 與 P75），
 * 因此這裡儲存的最小單位是「邊界」而不是「區間」。
 *
 * 規格：Profile 只影響目前庫存與觀察清單的條件提示，
 * 不回頭改寫原始交易、研究樣本或歷史快照。
 */
export type BoundaryOrigin = 'candidate' | 'manual';

export type ProfileBoundary = {
  value: number;
  origin: BoundaryOrigin;
  /** 來源研究批次，供日後回頭檢視這個數字是怎麼來的。手動輸入時為 null。 */
  sourceRunId: string | null;
  /** 套用當下該區間的證據等級。 */
  sourceEvidence: EvidenceLevel | null;
  /** 明知證據不足仍套用。永久保留，不因日後樣本變多而自動清除。 */
  appliedDespiteWeakEvidence: boolean;
  updatedAt: string;
};

export type ProfileEntry = {
  lower: ProfileBoundary | null;
  upper: ProfileBoundary | null;
};

export type ProfileKey = `${AssetClass}:${ResearchMetric}`;

export type Profile = {
  version: 1;
  entries: Partial<Record<ProfileKey, ProfileEntry>>;
};

export type CandidateApplication = {
  assetClass: AssetClass;
  metric: ResearchMetric;
  band: BandId;
  range: { min: number | null; max: number | null };
  runId: string | null;
  evidence: EvidenceLevel | null;
  despiteWeakEvidence: boolean;
  at: string;
};

const EMPTY_ENTRY: ProfileEntry = { lower: null, upper: null };

export function emptyProfile(): Profile {
  return { version: 1, entries: {} };
}

export function profileKey(assetClass: AssetClass, metric: ResearchMetric): ProfileKey {
  return `${assetClass}:${metric}`;
}

export function readEntry(
  profile: Profile,
  assetClass: AssetClass,
  metric: ResearchMetric,
): ProfileEntry {
  return profile.entries[profileKey(assetClass, metric)] ?? EMPTY_ENTRY;
}

function boundary(value: number, application: CandidateApplication): ProfileBoundary {
  return {
    value,
    origin: 'candidate',
    sourceRunId: application.runId,
    sourceEvidence: application.evidence,
    appliedDespiteWeakEvidence: application.despiteWeakEvidence,
    updatedAt: application.at,
  };
}

/**
 * 把一個候選區間寫進 Profile，回傳新的 Profile（不修改傳入的那份）。
 *
 * 回檔側只定義下界、偏熱側只定義上界，中間區由兩端夾出來，
 * 因此套用中間區等於同時接受這兩個數字。
 */
export function applyCandidate(profile: Profile, application: CandidateApplication): Profile {
  const { band, range } = application;
  const entry = readEntry(profile, application.assetClass, application.metric);

  let next: ProfileEntry;

  if (band === 'pullback') {
    if (range.max === null) throw new Error('回檔側沒有可用門檻，不能套用');
    next = { ...entry, lower: boundary(range.max, application) };
  } else if (band === 'overheated') {
    if (range.min === null) throw new Error('偏熱側沒有可用門檻，不能套用');
    next = { ...entry, upper: boundary(range.min, application) };
  } else {
    if (range.min === null || range.max === null) {
      throw new Error('中間區沒有完整門檻，不能套用');
    }
    next = {
      lower: boundary(range.min, application),
      upper: boundary(range.max, application),
    };
  }

  return {
    ...profile,
    entries: {
      ...profile.entries,
      [profileKey(application.assetClass, application.metric)]: next,
    },
  };
}

/**
 * 依 Profile 判斷一個指標值落在哪一區。
 *
 * 只設了一端時，超出該端的值可以判定，但另一側一律回未分類——
 * 不知道另一端在哪，就不能宣稱它「合理」。寧可承認未分類，
 * 也不要給一個沒有依據的分類。
 */
export function classifyByProfile(value: number | null, entry: ProfileEntry): BandId | null {
  if (value === null) return null;

  const { lower, upper } = entry;

  if (lower !== null && value <= lower.value) return 'pullback';
  if (upper !== null && value >= upper.value) return 'overheated';
  if (lower !== null && upper !== null) return 'normal';

  return null;
}

/** Profile 是否已設定任何門檻。 */
export function isProfileEmpty(profile: Profile): boolean {
  return Object.values(profile.entries).every(
    (entry) => entry === undefined || (entry.lower === null && entry.upper === null),
  );
}
