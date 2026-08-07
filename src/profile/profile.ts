import type { ResearchMetric, ResearchScenario, ScenarioResearchMetric } from '../research/runResearch';
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
  /** V2 情境專屬候選；既有通用 entries 不自動搬移。 */
  scenarioEntries?: Partial<Record<ScenarioProfileKey, ProfileEntry>>;
};

export type ScenarioProfileKey = `${ResearchScenario}:${AssetClass}:${ScenarioResearchMetric}`;

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

export function scenarioProfileKey(
  scenario: ResearchScenario,
  assetClass: AssetClass,
  metric: ScenarioResearchMetric,
): ScenarioProfileKey {
  return `${scenario}:${assetClass}:${metric}`;
}

export function readScenarioEntry(
  profile: Profile,
  scenario: ResearchScenario,
  assetClass: AssetClass,
  metric: ScenarioResearchMetric,
): ProfileEntry {
  return profile.scenarioEntries?.[scenarioProfileKey(scenario, assetClass, metric)] ?? EMPTY_ENTRY;
}

export function readEntry(
  profile: Profile,
  assetClass: AssetClass,
  metric: ResearchMetric,
): ProfileEntry {
  return profile.entries[profileKey(assetClass, metric)] ?? EMPTY_ENTRY;
}

function boundary(
  value: number,
  application: Pick<CandidateApplication, 'runId' | 'evidence' | 'despiteWeakEvidence' | 'at'>,
): ProfileBoundary {
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

/** 專屬情境候選與通用 Profile 完全分開保存。 */
export function applyScenarioCandidate(
  profile: Profile,
  application: Omit<CandidateApplication, 'metric'> & {
    scenario: ResearchScenario;
    metric: ScenarioResearchMetric;
  },
): Profile {
  const entry = readScenarioEntry(profile, application.scenario, application.assetClass, application.metric);
  const { band, range } = application;
  let next: ProfileEntry;
  if (band === 'pullback') {
    if (range.max === null) throw new Error('回檔側沒有可用門檻，不能套用');
    next = { ...entry, lower: boundary(range.max, application) };
  } else if (band === 'overheated') {
    if (range.min === null) throw new Error('偏熱側沒有可用門檻，不能套用');
    next = { ...entry, upper: boundary(range.min, application) };
  } else {
    if (range.min === null || range.max === null) throw new Error('中間區沒有完整門檻，不能套用');
    next = { lower: boundary(range.min, application), upper: boundary(range.max, application) };
  }
  return {
    ...profile,
    scenarioEntries: {
      ...profile.scenarioEntries,
      [scenarioProfileKey(application.scenario, application.assetClass, application.metric)]: next,
    },
  };
}

export type BoundarySide = 'lower' | 'upper';

export type BoundaryTarget = {
  assetClass: AssetClass;
  metric: ResearchMetric;
  side: BoundarySide;
};

export type ScenarioBoundaryTarget = Omit<BoundaryTarget, 'metric'> & {
  scenario: ResearchScenario;
  metric: ScenarioResearchMetric;
};

function writeEntry(profile: Profile, target: BoundaryTarget, entry: ProfileEntry): Profile {
  return {
    ...profile,
    entries: {
      ...profile.entries,
      [profileKey(target.assetClass, target.metric)]: entry,
    },
  };
}

/**
 * 手動設定一個邊界。
 *
 * 來源批次與證據等級一律清空：手動改過之後，這個數字就不再是那批研究的結論，
 * 繼續掛著來源會讓畫面謊稱它有經過驗證。畫面上改以「自訂／未驗證」標示。
 */
export function setManualBoundary(
  profile: Profile,
  { assetClass, metric, side, value, at }: BoundaryTarget & { value: number; at: string },
): Profile {
  const entry = readEntry(profile, assetClass, metric);

  return writeEntry(
    profile,
    { assetClass, metric, side },
    {
      ...entry,
      [side]: {
        value,
        origin: 'manual',
        sourceRunId: null,
        sourceEvidence: null,
        appliedDespiteWeakEvidence: false,
        updatedAt: at,
      },
    },
  );
}

/** 清除一個邊界，回到未設定。 */
export function clearBoundary(profile: Profile, target: BoundaryTarget): Profile {
  const entry = readEntry(profile, target.assetClass, target.metric);

  return writeEntry(profile, target, { ...entry, [target.side]: null });
}

function writeScenarioEntry(
  profile: Profile,
  target: ScenarioBoundaryTarget,
  entry: ProfileEntry,
): Profile {
  return {
    ...profile,
    scenarioEntries: {
      ...profile.scenarioEntries,
      [scenarioProfileKey(target.scenario, target.assetClass, target.metric)]: entry,
    },
  };
}

export function setScenarioManualBoundary(
  profile: Profile,
  target: ScenarioBoundaryTarget & { value: number; at: string },
): Profile {
  const entry = readScenarioEntry(profile, target.scenario, target.assetClass, target.metric);
  return writeScenarioEntry(profile, target, {
    ...entry,
    [target.side]: {
      value: target.value,
      origin: 'manual',
      sourceRunId: null,
      sourceEvidence: null,
      appliedDespiteWeakEvidence: false,
      updatedAt: target.at,
    },
  });
}

export function clearScenarioBoundary(profile: Profile, target: ScenarioBoundaryTarget): Profile {
  const entry = readScenarioEntry(profile, target.scenario, target.assetClass, target.metric);
  return writeScenarioEntry(profile, target, { ...entry, [target.side]: null });
}

export function isScenarioProfileEmpty(profile: Profile, scenario: ResearchScenario): boolean {
  return Object.entries(profile.scenarioEntries ?? {})
    .filter(([key]) => key.startsWith(`${scenario}:`))
    .every(([, entry]) => entry === undefined || (entry.lower === null && entry.upper === null));
}

/**
 * 下界不低於上界時，三個區間退化——中間區永遠是空的。
 * 這種設定沒有意義，儲存前要擋下來。
 */
export function boundaryConflict(entry: ProfileEntry): boolean {
  if (entry.lower === null || entry.upper === null) return false;

  return entry.lower.value >= entry.upper.value;
}

/** Profile 是否含有手動設定、未經驗證的門檻。 */
export function hasUnverifiedBoundary(profile: Profile): boolean {
  return Object.values(profile.entries).some(
    (entry) => entry?.lower?.origin === 'manual' || entry?.upper?.origin === 'manual',
  );
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
