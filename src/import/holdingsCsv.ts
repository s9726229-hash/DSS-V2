import { buildHeaderMap, parseAmount, splitCsvLine, splitCsvRows } from './csv';
import type { CsvParseResult, ImportedHolding, SkippedRow } from './types';

const REQUIRED_COLUMNS = [
  '股票代號',
  '股票名稱',
  '交易類別',
  '合計庫存數量',
  '成本均價',
  '現價',
] as const;

/** 檔尾的「[TWD台幣]總計：」列沒有股票代號，略過但不算錯誤。 */
function isTotalRow(rawStockId: string): boolean {
  return rawStockId.trim() === '';
}

export function parseHoldingsCsv(csv: string): CsvParseResult<ImportedHolding> {
  const lines = splitCsvRows(csv);

  if (lines.length === 0) {
    return { ok: false, error: '檔案沒有內容', missingColumns: [] };
  }

  const headers = buildHeaderMap(lines[0]);
  const missingColumns = REQUIRED_COLUMNS.filter((column) => !headers.has(column));

  if (missingColumns.length > 0) {
    return {
      ok: false,
      error: `缺少必要欄位：${missingColumns.join('、')}`,
      missingColumns,
    };
  }

  const rows: ImportedHolding[] = [];
  const skipped: SkippedRow[] = [];

  for (let index = 1; index < lines.length; index += 1) {
    const fields = splitCsvLine(lines[index]);
    const line = index + 1;
    const at = (column: string): string => fields[headers.get(column) as number] ?? '';

    if (isTotalRow(at('股票代號'))) {
      continue;
    }

    const quantity = parseAmount(at('合計庫存數量'));
    if (quantity === null) {
      skipped.push({ line, reason: '合計庫存數量無法解析' });
      continue;
    }

    // 當日全數賣出後庫存為 0，不是持股
    if (quantity === 0) {
      continue;
    }

    const costPrice = parseAmount(at('成本均價'));
    if (costPrice === null) {
      skipped.push({ line, reason: '成本均價無法解析' });
      continue;
    }

    const currentPrice = parseAmount(at('現價'));
    if (currentPrice === null) {
      skipped.push({ line, reason: '現價無法解析' });
      continue;
    }

    rows.push({
      stockId: at('股票代號').trim(),
      stockName: at('股票名稱').trim(),
      tradeType: at('交易類別').trim(),
      quantity,
      costPrice,
      currentPrice,
    });
  }

  return { ok: true, rows, skipped };
}
