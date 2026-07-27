import { buildHeaderMap, parseAmount, parseTradeDate, splitCsvLine, splitCsvRows } from './csv';
import type { CsvParseResult, ImportedTransaction, SkippedRow, TransactionSide } from './types';

const REQUIRED_COLUMNS = [
  '成交日期',
  '股票代號',
  '股票名稱',
  '買賣別',
  '交易類別',
  '成交數量',
  '成交價',
  '手續費',
  '交易稅',
] as const;

const SIDE_BY_LABEL: Record<string, TransactionSide> = {
  買: 'buy',
  賣: 'sell',
};

/**
 * 券商在每個交易日後會插入一列「2026/03/02 小計」彙總列，
 * 它不是交易紀錄，略過但不算錯誤。
 */
function isSubtotalRow(rawTradeDate: string, rawStockId: string): boolean {
  return rawTradeDate.includes('小計') || rawStockId.trim() === '';
}

export function parseTransactionCsv(csv: string): CsvParseResult<ImportedTransaction> {
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

  // 委託書號位於標題列結尾的無名欄位，只能以位置取得。
  const brokerReferenceIndex = splitCsvLine(lines[0]).length - 1;

  const rows: ImportedTransaction[] = [];
  const skipped: SkippedRow[] = [];

  for (let index = 1; index < lines.length; index += 1) {
    const fields = splitCsvLine(lines[index]);
    const line = index + 1;
    const at = (column: string): string => fields[headers.get(column) as number] ?? '';

    if (isSubtotalRow(at('成交日期'), at('股票代號'))) {
      continue;
    }

    const tradeDate = parseTradeDate(at('成交日期'));
    if (tradeDate === null) {
      skipped.push({ line, reason: '成交日期無法解析' });
      continue;
    }

    const side = SIDE_BY_LABEL[at('買賣別').trim()];
    if (side === undefined) {
      skipped.push({ line, reason: '買賣別無法辨識' });
      continue;
    }

    const quantity = parseAmount(at('成交數量'));
    if (quantity === null) {
      skipped.push({ line, reason: '成交數量無法解析' });
      continue;
    }

    const price = parseAmount(at('成交價'));
    if (price === null) {
      skipped.push({ line, reason: '成交價無法解析' });
      continue;
    }

    const fees = parseAmount(at('手續費'));
    if (fees === null) {
      skipped.push({ line, reason: '手續費無法解析' });
      continue;
    }

    const tax = parseAmount(at('交易稅'));
    if (tax === null) {
      skipped.push({ line, reason: '交易稅無法解析' });
      continue;
    }

    rows.push({
      tradeDate,
      stockId: at('股票代號').trim(),
      stockName: at('股票名稱').trim(),
      side,
      tradeType: at('交易類別').trim(),
      quantity,
      price,
      fees,
      tax,
      settlementDate: parseTradeDate(at('交割日')),
      brokerReference: fields[brokerReferenceIndex]?.trim() || null,
    });
  }

  return { ok: true, rows, skipped };
}
