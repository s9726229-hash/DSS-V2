/**
 * 撤銷 blob URL 的延遲。
 *
 * anchor.click() 只是把下載排進佇列，實際讀取 blob 是之後的事；
 * 立刻撤銷會讓還沒開始讀的下載中斷，而且不會有任何錯誤訊息。
 * 檔案越大越容易踩到——完整備份含市場快取，可能有數 MB。
 */
export const REVOKE_DELAY_MS = 60_000;

/**
 * 把資料序列化成 JSON 檔並觸發下載。
 *
 * 序列化失敗會往外拋，讓呼叫端顯示錯誤；靜默失敗會變成
 * 「按了沒反應」這種極難查的狀況。
 */
export function downloadJson(payload: unknown, fileName: string): void {
  const text = JSON.stringify(payload);
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');

  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = 'noopener';

  /*
   * 必須先加進文件再按。脫離文件的 anchor 在部分瀏覽器不會觸發下載，
   * 同樣不拋錯——畫面看起來一切正常，檔案卻沒出現。
   */
  document.body.append(anchor);

  try {
    anchor.click();
  } finally {
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS);
  }
}
