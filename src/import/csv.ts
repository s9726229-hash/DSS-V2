/**
 * 券商 CSV 的共通低階解析工具。
 *
 * 刻意採「標題名稱 → 欄位索引」的對應方式，而非寫死欄位位置：
 * 若券商調整欄位順序或新增欄位，解析會明確失敗而不是靜默讀到錯誤欄位。
 */

/** 依逗號分欄，並讓引號內的逗號（千分位數字）不被視為分隔符。 */
export function splitCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (const char of line) {
    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === ',' && !inQuotes) {
      fields.push(current);
      current = '';
      continue;
    }

    current += char;
  }

  fields.push(current);
  return fields;
}

/** 切分換行並略過空白列（券商匯出常在檔尾留空行）。 */
export function splitCsvRows(csv: string): string[] {
  return csv.split(/\r?\n/).filter((line) => line.trim().length > 0);
}

/** 由標題列建立「標題名稱 → 欄位索引」的對應表。 */
export function buildHeaderMap(headerLine: string): Map<string, number> {
  const map = new Map<string, number>();

  splitCsvLine(headerLine).forEach((rawHeader, index) => {
    const header = rawHeader.trim();

    if (header && !map.has(header)) {
      map.set(header, index);
    }
  });

  return map;
}

const NUMERIC_PATTERN = /^-?\d+(\.\d+)?$/;

/** 解析含千分位的金額；無法解析時回傳 null，避免靜默產生 NaN。 */
export function parseAmount(raw: string | undefined): number | null {
  if (raw === undefined) {
    return null;
  }

  const normalized = raw.trim().replace(/,/g, '');

  if (!NUMERIC_PATTERN.test(normalized)) {
    return null;
  }

  return Number(normalized);
}

const DATE_PATTERN = /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/;

/** 把 `2025/01/02` 正規化為 `2025-01-02`；非合法日期回傳 null。 */
export function parseTradeDate(raw: string | undefined): string | null {
  if (raw === undefined) {
    return null;
  }

  const match = DATE_PATTERN.exec(raw.trim());

  if (!match) {
    return null;
  }

  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));

  // 攔截 2025/02/30 這類會被 Date 自動進位的日期
  if (date.getUTCMonth() !== Number(month) - 1 || date.getUTCDate() !== Number(day)) {
    return null;
  }

  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}
