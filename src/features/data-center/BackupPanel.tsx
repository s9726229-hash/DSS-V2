import { useId, useState } from 'react';
import { createBackup, createLightweightBackup, restoreBackup } from '../../storage/backup';
import './BackupPanel.css';

type Message = { tone: 'ok' | 'attention'; text: string } | null;

function download(payload: unknown, fileName: string): void {
  const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');

  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

function stamp(): string {
  return new Date().toISOString().slice(0, 10);
}

export function BackupPanel({ onDataChanged }: { onDataChanged: () => void }) {
  const [message, setMessage] = useState<Message>(null);
  const inputId = useId();

  async function handleFull() {
    download(await createBackup(), `dss-v2-完整備份-${stamp()}.json`);
    setMessage({ tone: 'ok', text: '完整備份已下載。' });
  }

  async function handleLightweight() {
    download(await createLightweightBackup(), `dss-v2-輕量備份-${stamp()}.json`);
    setMessage({ tone: 'ok', text: '輕量備份已下載。' });
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
        <button type="button" className="btn" onClick={() => void handleFull()}>
          完整備份
        </button>
        <button type="button" className="btn" onClick={() => void handleLightweight()}>
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
