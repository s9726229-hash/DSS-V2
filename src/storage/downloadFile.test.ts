import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { downloadJson, REVOKE_DELAY_MS } from './downloadFile';

type ClickRecord = {
  download: string;
  href: string;
  /** 按下當下 anchor 是否在文件中。 */
  inDocument: boolean;
};

let clicks: ClickRecord[];
let created: string[];
let revoked: string[];

beforeEach(() => {
  clicks = [];
  created = [];
  revoked = [];

  vi.useFakeTimers();

  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => {
    const url = `blob:test/${created.length}`;
    created.push(url);
    return url;
  });
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation((url: string) => {
    revoked.push(url);
  });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    clicks.push({
      download: this.download,
      href: this.href,
      inDocument: document.body.contains(this),
    });
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('下載 JSON', () => {
  it('以指定檔名觸發下載', () => {
    downloadJson({ hello: 'world' }, 'backup.json');

    expect(clicks).toHaveLength(1);
    expect(clicks[0].download).toBe('backup.json');
  });

  /**
   * 脫離文件的 anchor 在部分瀏覽器（例如 Firefox）不會觸發下載，
   * 且不會拋出任何錯誤——畫面看起來一切正常，檔案卻沒出現。
   */
  it('按下當下 anchor 必須在文件中', () => {
    downloadJson({}, 'backup.json');

    expect(clicks[0].inDocument).toBe(true);
  });

  it('按完就把 anchor 移除，不留殘骸在頁面上', () => {
    downloadJson({}, 'backup.json');

    expect(document.querySelectorAll('a[download]')).toHaveLength(0);
  });

  /**
   * click() 只是把下載排進佇列，實際讀取 blob 是之後的事。
   * 立刻撤銷 URL 會讓還沒開始讀的下載中斷，檔案越大越容易發生。
   */
  it('不在按下當下撤銷 URL', () => {
    downloadJson({}, 'backup.json');

    expect(created).toHaveLength(1);
    expect(revoked).toEqual([]);
  });

  it('延遲後才撤銷，避免長時間佔用記憶體', () => {
    downloadJson({}, 'backup.json');

    vi.advanceTimersByTime(REVOKE_DELAY_MS);

    expect(revoked).toEqual(created);
  });

  it('內容以 JSON 序列化', () => {
    const blobSpy = vi.spyOn(globalThis, 'Blob');

    downloadJson({ a: 1 }, 'backup.json');

    expect(blobSpy.mock.calls[0][0]).toEqual(['{"a":1}']);
    expect(blobSpy.mock.calls[0][1]).toEqual({ type: 'application/json' });
  });

  it('序列化失敗時拋出，讓呼叫端能顯示錯誤而不是靜默無事', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    expect(() => downloadJson(circular, 'backup.json')).toThrow();
    expect(clicks).toEqual([]);
  });
});
