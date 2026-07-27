import { describe, expect, it } from 'vitest';
import { decodeBrokerCsv } from './decode';

/** 「台股」的 Big5 位元組：a5 78 aa d1 */
const BIG5_TAIWAN_STOCK = new Uint8Array([0xa5, 0x78, 0xaa, 0xd1]);
const UTF8_BOM = new Uint8Array([0xef, 0xbb, 0xbf]);

function toArrayBuffer(...parts: Uint8Array[]): ArrayBuffer {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const merged = new Uint8Array(total);
  let offset = 0;

  for (const part of parts) {
    merged.set(part, offset);
    offset += part.length;
  }

  return merged.buffer;
}

describe('decodeBrokerCsv', () => {
  it('以 Big5 解碼券商匯出的中文內容', () => {
    expect(decodeBrokerCsv(toArrayBuffer(BIG5_TAIWAN_STOCK))).toBe('台股');
  });

  it('偵測到 UTF-8 BOM 時改用 UTF-8 解碼並去除 BOM', () => {
    const utf8Body = new TextEncoder().encode('台股');

    expect(decodeBrokerCsv(toArrayBuffer(UTF8_BOM, utf8Body))).toBe('台股');
  });

  it('無 BOM 的純 ASCII 內容在兩種編碼下結果一致', () => {
    const ascii = new TextEncoder().encode('0050,ETF');

    expect(decodeBrokerCsv(toArrayBuffer(ascii))).toBe('0050,ETF');
  });
});
