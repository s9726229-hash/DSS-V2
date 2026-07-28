import './GuidePage.css';

function Entry({
  term,
  meaning,
  basis,
}: {
  term: string;
  meaning: string;
  basis?: string;
}) {
  return (
    <div className="entry">
      <dt className="entry__term">{term}</dt>
      <dd className="entry__meaning">
        {meaning}
        {basis ? <span className="entry__basis">{basis}</span> : null}
      </dd>
    </div>
  );
}

export function GuidePage() {
  return (
    <div className="guide">
      <header className="guide__head">
        <h1 className="guide__title">判讀說明</h1>
        <p className="guide__lede">
          技術分析頁上每個數字與狀態的計算方式與涵義。所有狀態只描述資料事實，不代表買賣建議。
        </p>
      </header>

      <section className="guide__section" aria-label="計算前提">
        <h2 className="guide__section-title">計算前提</h2>
        <dl className="guide__list">
          <Entry
            term="資料時點"
            meaning="一律以最近一個已完成的交易日收盤資料計算。"
            basis="盤中不重算均線；目前未啟用盤中價格。"
          />
          <Entry
            term="價格未還原"
            meaning="目前使用未還原權息的原始收盤價。"
            basis="配息與分割會讓股價帳面下跌，但資產並未減少；若這類事件落在均線計算區間內，MA 與乖離率會偏低，技術分析頁會標示受影響的個股。"
          />
          <Entry
            term="資料不足"
            meaning="價格少於 60 筆時不計算任何技術指標；外資或投信不足 5 個交易日時不計算籌碼結果。"
            basis="寧可顯示「資料不足」，也不以殘缺資料產生看似完整的判斷。"
          />
        </dl>
      </section>

      <section className="guide__section" aria-label="技術面">
        <h2 className="guide__section-title">技術面</h2>
        <dl className="guide__list">
          <Entry term="MA5（週線）" meaning="最近 5 個交易日收盤價的平均。短線輔助參考。" />
          <Entry term="MA20（月線）" meaning="最近 20 個交易日收盤價的平均。主要判斷軸。" />
          <Entry term="MA60（季線）" meaning="最近 60 個交易日收盤價的平均。只看結構位置。" />
          <Entry
            term="Bias20（乖離率）"
            meaning="收盤價偏離月線的百分比。"
            basis="（收盤 − MA20）÷ MA20 × 100%。正值代表收盤在月線之上。"
          />
          <Entry
            term="站上／跌破"
            meaning="收盤價高於或低於該條均線。"
            basis="三條線各自獨立，可能同時出現跌破週線但站上季線。"
          />
        </dl>

        <h3 className="guide__sub-title">月線狀態</h3>
        <dl className="guide__list">
          <Entry term="收復月線" meaning="前一日收盤在月線之下，當日收盤站上月線。" />
          <Entry term="站穩月線" meaning="前一日與當日收盤都在月線之上。" />
          <Entry term="跌破月線" meaning="當日收盤在月線之下。" />
        </dl>

        <h3 className="guide__sub-title">回穩判定</h3>
        <dl className="guide__list">
          <Entry
            term="回檔後回穩觀察"
            meaning="收盤剛由月線下方穿越至上方，僅為觀察。"
            basis="單日穿越不足以確認，需再觀察一個交易日。"
          />
          <Entry
            term="回檔後回穩"
            meaning="穿越月線後的下一個交易日仍站在月線之上。"
          />
        </dl>

        <h3 className="guide__sub-title">風險提醒</h3>
        <p className="guide__caution">
          以下兩項提醒你重新檢視持倉，<strong>不是賣出指令</strong>。
        </p>
        <dl className="guide__list">
          <Entry term="回檔觀察" meaning="收盤跌回月線下方。" />
          <Entry
            term="趨勢轉弱"
            meaning="連續 2 個交易日收盤在季線下方。"
            basis="需要兩日確認；若資料筆數不足以確認前一日的季線，不會發出此提醒。"
          />
        </dl>
      </section>

      <section className="guide__section" aria-label="籌碼面">
        <h2 className="guide__section-title">籌碼面</h2>
        <dl className="guide__list">
          <Entry
            term="外資及陸資"
            meaning="官方分類的「外資及陸資（不含外資自營商）」。"
            basis="外資自營商是獨立身分，不併入外資計算。"
          />
          <Entry term="投信" meaning="國內投信法人。與外資完全分開計算，不合併。" />
          <Entry
            term="5 日淨額"
            meaning="最近 5 個交易日買超減賣超的合計，以張為單位。"
            basis="只採用能對應到成交量的交易日，確保與平均量涵蓋同一期間。"
          />
          <Entry
            term="強度"
            meaning="5 日淨額除以同期間 5 日平均成交量。"
            basis="正規化後可跨個股比較。+0.5 代表 5 日淨額約等於半天的成交量。"
          />
          <Entry
            term="連續性"
            meaning="由最後一日往前推，同方向的連續天數。"
            basis="最後一日持平時記為「無連續」。"
          />
        </dl>

        <h3 className="guide__sub-title">聯合狀態</h3>
        <p className="guide__caution">
          僅為顯示用的並列描述，<strong>不形成綜合評分，也不覆寫技術面結果</strong>。
        </p>
        <dl className="guide__list">
          <Entry term="外資與投信同買" meaning="兩者 5 日淨額皆為正。" />
          <Entry term="外資與投信同賣" meaning="兩者 5 日淨額皆為負。" />
          <Entry term="外資與投信分歧" meaning="兩者方向相反。" />
          <Entry term="無共識" meaning="任一方 5 日淨額為零。" />
          <Entry
            term="法人資料未就緒"
            meaning="外資或投信任一方不足 5 個可用交易日。"
            basis="此時不顯示中性或無共識，並標示最後可用日期。"
          />
        </dl>
      </section>

      <section className="guide__section" aria-label="本系統不做的事">
        <h2 className="guide__section-title">本系統不做的事</h2>
        <ul className="guide__nots">
          <li>不因單一均線穿越顯示買進或賣出。</li>
          <li>不把技術面與籌碼面合併成單一分數或燈號。</li>
          <li>不以籌碼狀態覆寫或升級技術面結果。</li>
          <li>不使用 RSI、KD 與融資資料。</li>
          <li>不因大盤狀況自動阻斷任何判斷。</li>
        </ul>
        <p className="guide__closing">
          最終買賣由你判斷。本工具只提供資料、條件與風險提示。
        </p>
      </section>
    </div>
  );
}
