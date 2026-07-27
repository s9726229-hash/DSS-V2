const UTF8_BOM = [0xef, 0xbb, 0xbf];

function hasUtf8Bom(bytes: Uint8Array): boolean {
  return UTF8_BOM.every((byte, index) => bytes[index] === byte);
}

/**
 * 券商匯出的 CSV 一律是 Big5；少數其他來源是帶 BOM 的 UTF-8。
 * 以 BOM 判斷編碼，避免把 UTF-8 內容當成 Big5 解出亂碼。
 */
export function decodeBrokerCsv(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);

  if (hasUtf8Bom(bytes)) {
    return new TextDecoder('utf-8').decode(bytes.subarray(UTF8_BOM.length));
  }

  return new TextDecoder('big5').decode(bytes);
}

export async function readBrokerCsvFile(file: File): Promise<string> {
  return decodeBrokerCsv(await file.arrayBuffer());
}
