import { useId, useState } from 'react';
import { createBackup, createLightweightBackup, restoreBackup } from '../../storage/backup';
import { downloadJson } from '../../storage/downloadFile';
import './BackupPanel.css';

type Message = { tone: 'ok' | 'attention'; text: string } | null;

function stamp(): string {
  return new Date().toISOString().slice(0, 10);
}

export function BackupPanel({ onDataChanged }: { onDataChanged: () => void }) {
  const [message, setMessage] = useState<Message>(null);
  const inputId = useId();

  /**
   * 備份下載。
   *
   * 訊息刻意寫「已送出下載」而不是「已下載」：瀏覽器是否真的存下檔案，
   * 網頁端無從得知。站台的自動下載權限被封鎖時會靜默失敗，
   * 寫成「已下載」會讓使用者以為程式壞了而不是去看瀏覽器設定。
   */
  async function runBackup(kind: 'full' | 'lightweight') {
    const label = kind === 'full' ? '完整備份' : '輕量備份';

    setMessage({ tone: 'ok', text: `正在準備${label}…` });

    try {
      const payload = kind === 'full' ? await createBackup() : await createLightweightBackup();
      downloadJson(payload, `dss-v2-${label}-${stamp()}.json`);
      setMessage({
        tone: 'ok',
        text: `${label}已送出下載。若瀏覽器沒有出現檔案，請檢查這個網站的「自動下載」權限。`,
      });
    } catch (error) {
      setMessage({
        tone: 'attention',
        text: `${label}失敗：${error instanceof Error ? error.message : '未知錯誤'}`,
      });
    }
  }

  async function handleRestore(file: File | undefined) {
    if (!file) return;

    let parsed: unknown;

    try {
      parsed = JSON.parse(await file.text());
    } catch {
      setMessage({ tone: 'attention', text: '備份檔格式不正確：不是有效的 JSON。' });
      return;
    }

    const result = await restoreBackup(parsed);

    if (!result.ok) {
      setMessage({ tone: 'attention', text: result.error });
      return;
    }

    setMessage({
      tone: 'ok',
      text: `已還原 ${result.restored.transactions} 筆交易與 ${result.restored.holdingsSnapshots} 筆庫存紀錄。`,
    });
    onDataChanged();
  }

  return (
    <section className="backup" aria-label="備份與還原">
      <header className="backup__head">
        <h3 className="backup__title">備份與還原</h3>
        <p className="backup__description">
          完整備份包含市場快取，檔案較大但還原後不需重新向 FinMind 取資料。
          輕量備份只有交易、庫存與設定。兩者都不含任何憑證。
        </p>
      </header>

      <div className="backup__actions">
        <button type="button" className="btn" onClick={() => void runBackup('full')}>
          完整備份
        </button>
        <button type="button" className="btn" onClick={() => void runBackup('lightweight')}>
          輕量備份
        </button>
        <label className="backup__restore" htmlFor={inputId}>
          還原備份
          <input
            id={inputId}
            aria-label="選擇備份檔還原"
            type="file"
            accept="application/json,.json"
            onChange={(event) => {
              void handleRestore(event.target.files?.[0]);
              event.target.value = '';
            }}
          />
        </label>
      </div>

      {message ? (
        <p className={`backup__message backup__message--${message.tone}`}>{message.text}</p>
      ) : null}

      <p className="backup__warning">還原會取代目前本機的交易、庫存與設定。</p>
    </section>
  );
}
