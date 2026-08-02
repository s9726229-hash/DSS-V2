import './GuidePage.css';
import { CalculationFlow } from '../analysis/CalculationFlow';
import { ResearchFlow } from '../research/ResearchFlow';

function Entry({
  term,
  meaning,
  detail,
  detailLabel = '怎麼算',
}: {
  term: string;
  meaning: string;
  detail?: string;
  detailLabel?: '怎麼算' | '為什麼';
}) {
  return (
    <div className="entry">
      <dt className="entry__term">{term}</dt>
      <dd className="entry__meaning">
        {meaning}
        {detail ? (
          <span className="entry__detail">
            <span className="entry__detail-label micro">{detailLabel}</span>
            {detail}
          </span>
        ) : null}
      </dd>
    </div>
  );
}

const JUMP_LINKS = [
  { href: '#today-flow', label: '今天的卡片' },
  { href: '#research-flow', label: '歷史研究' },
  { href: '#nots', label: '系統限制' },
];

export function GuidePage() {
  return (
    <div className="guide">
      <header className="guide__head">
        <h1 className="guide__title">系統怎麼算</h1>
        <p className="guide__lede">
          了解資料如何一路變成今天看到的判讀。所有狀態只描述資料事實，不代表買賣建議。
        </p>
        <nav className="guide__jump" aria-label="快速跳轉">
          {JUMP_LINKS.map((link) => (
            <a key={link.href} href={link.href}>
              {link.label}
            </a>
          ))}
        </nav>
      </header>

      <section className="guide__section guide__flow-section" aria-label="資料到判讀的總流程">
        <h2 className="guide__section-title">資料怎麼一路變成判讀</h2>
        <ol className="guide__flow-steps">
          <li>匯入：庫存與交易歷史只留在這台電腦。</li>
          <li>同步：中介服務取得允許使用的市場資料，瀏覽器不會取得 API Key。</li>
          <li>整理：有資料時先排除配息與分割造成的帳面跳動；不足就直接顯示資料不足。</li>
          <li>計算今天：技術面與法人流向分開計算，不混成單一分數。</li>
          <li>研究歷史：反覆用較早資料檢查候選門檻，結果是證據，不是預測。</li>
          <li>套用規則：只有你確認的規則，才會把候選門檻變成目前卡片的標籤。</li>
        </ol>
      </section>

      <section className="guide__section guide__flow-section" id="today-flow" aria-label="今天的卡片怎麼來">
        <h2 className="guide__section-title">今天的卡片怎麼來</h2>
        <p className="guide__flow-lede">先讀取本機資料，再分開算技術面與籌碼面；資料不夠時，不會硬算出結果。</p>
        <CalculationFlow />
      </section>

      <section className="guide__section guide__flow-section" id="research-flow" aria-label="歷史研究怎麼來">
        <h2 className="guide__section-title">歷史研究怎麼來</h2>
        <p className="guide__flow-lede">研究只用當時可取得的資料，確認候選門檻是否值得繼續追蹤。</p>
        <ResearchFlow />
      </section>

      <details className="guide__terms">
        <summary>名詞補充</summary>
        <p className="guide__terms-lede">想了解指標、資料前提與籌碼名詞時，再展開閱讀。</p>

      <section className="guide__section" id="premise" aria-label="計算前提">
        <h2 className="guide__section-title">計算前提</h2>
        <dl className="guide__list">
          <Entry
            term="資料時點"
            meaning="只用最近一個已經收盤的交易日資料計算，盤中不會即時更新。"
            detailLabel="為什麼"
            detail="目前還沒有開放盤中報價功能。"
          />
          <Entry
            term="價格已還原"
            meaning="所有均線和乖離率，都是用「還原權息與分割後」的價格算的。"
            detail="配息或分割當天，股價帳面上會跌，但資產並未減少；如果不還原，均線會被這個假跌幅拉低，乖離率也會算錯。還原後的價格是換算過的，與券商對帳單的成交價不會逐筆相同——技術分析頁的「計算流程」分頁會列出實際用了哪些還原事件。"
          />
          <Entry
            term="資料不足時怎麼辦"
            meaning="股價少於 60 天，或外資、投信任一邊少於 5 個交易日，就不算任何結果。"
            detailLabel="為什麼"
            detail="寧可顯示「資料不足」，也不要用不夠的資料硬算出一個看起來完整的答案。"
          />
        </dl>
      </section>

      <section className="guide__section" id="technical" aria-label="技術面">
        <h2 className="guide__section-title">技術面</h2>
        <dl className="guide__list guide__list--grid">
          <Entry term="MA5（週線）" meaning="最近 5 天收盤價的平均，短線看一下就好。" />
          <Entry term="MA20（月線）" meaning="最近 20 天收盤價的平均，是主要判斷依據。" />
          <Entry term="MA60（季線）" meaning="最近 60 天收盤價的平均，只看長期的結構位置。" />
          <Entry
            term="乖離率 Bias20"
            meaning="今天收盤比月線貴或便宜多少趴。正值代表收盤在月線之上。"
            detail="（收盤 − MA20）÷ MA20 × 100%"
          />
          <Entry
            term="站上／跌破"
            meaning="收盤價在這條均線之上，還是之下。"
            detailLabel="為什麼"
            detail="三條線各自獨立判斷，可能同時「跌破週線」又「站上季線」。"
          />
        </dl>

        <h3 className="guide__sub-title">月線狀態</h3>
        <dl className="guide__list guide__list--grid">
          <Entry term="收復月線" meaning="昨天收盤還在月線下面，今天收盤爬回月線之上。" />
          <Entry term="站穩月線" meaning="昨天、今天收盤都在月線之上。" />
          <Entry term="跌破月線" meaning="今天收盤在月線之下。" />
        </dl>

        <h3 className="guide__sub-title">回穩判定</h3>
        <dl className="guide__list">
          <Entry
            term="回檔後回穩觀察"
            meaning="收盤剛從月線下方爬上來，先觀察，還不算數。"
            detailLabel="為什麼"
            detail="只穿越一天不夠準，要再等下一天確認。"
          />
          <Entry term="回檔後回穩" meaning="爬上月線的隔一天，收盤還站在上面。" />
        </dl>

        <h3 className="guide__sub-title">風險提醒</h3>
        <p className="guide__caution">
          以下兩項提醒你重新檢視持倉，<strong>不是賣出指令</strong>。
        </p>
        <dl className="guide__list">
          <Entry term="回檔觀察" meaning="收盤又跌回月線下面了。" />
          <Entry
            term="趨勢轉弱"
            meaning="連續兩天收盤都在季線下面。"
            detailLabel="為什麼"
            detail="只看一天容易判斷錯誤，需要兩天都跌破才提醒；如果資料不夠算出前一天的季線，這個提醒不會出現。"
          />
        </dl>
      </section>

      <section className="guide__section" id="chip" aria-label="籌碼面">
        <h2 className="guide__section-title">籌碼面</h2>
        <dl className="guide__list guide__list--grid">
          <Entry
            term="外資"
            meaning="官方的「外資及陸資」，統計時不含外資自營商。"
            detailLabel="為什麼"
            detail="外資自營商是獨立身分，不併入外資計算。實測你的持股，這一項的數字全部是 0。"
          />
          <Entry term="投信" meaning="國內的投信法人，跟外資完全分開算，不會合併看。" />
          <Entry
            term="今日／前五日均"
            meaning="今天這一天的買賣超，跟前面五天的平均比。前五天不包含今天。"
            detailLabel="為什麼"
            detail="今天若算進平均，等於自己墊高自己的比較基準，變化會被自己稀釋掉。"
          />
          <Entry
            term="方向變化"
            meaning="先看今天是買還是賣，再跟近期比力道。所以會寫成「買超增加」「賣超減少」「由買轉賣」這種話。"
            detailLabel="為什麼"
            detail="直接把今日除以近期平均，遇到買轉賣只會得到一個負數，看不出方向翻了。先判方向、再比力道才講得清楚。"
          />
          <Entry
            term="力道 N 倍"
            meaning="今天的量是近期平均的幾倍。1.43 倍就是比平常多四成。"
            detailLabel="怎麼算"
            detail="兩邊都取絕對值再相除，所以反轉時也算得出倍數。近期平均接近零時沒有東西可比，會寫「無法比較」而不是填 0。"
          />
          <Entry
            term="中性"
            meaning="買賣超小到沒有意義時，不講方向，直接說中性。"
            detailLabel="怎麼算"
            detail="門檻取「近期平均的一成」與「固定張數下限」之中較大的那個。只用比例的話，平均接近零時中性帶會窄到幾乎不存在。"
          />
          <Entry
            term="流向"
            meaning="卡片方塊與研究頁用的那個數字：今日淨額除以前五日平均的絕對值。負的是今天在賣、正的是今天在買。"
            detailLabel="為什麼"
            detail="研究要找門檻，需要一條能排序的連續數值，十二種方向分類切不動幾十筆樣本。顯示仍然用「買超增加／由買轉賣」那句話，帶正負號的除法只當研究軸。"
          />
          <Entry
            term="5 日淨額"
            meaning="最近 5 個交易日，買進和賣出張數的差，正值代表買超。"
            detailLabel="為什麼"
            detail="只用能對到成交量的交易日，確保跟 5 日均量算的是同一段期間。"
          />
          <Entry
            term="強度"
            meaning="這 5 天買超（或賣超）的量，相當於平常幾天的成交量。+0.5 大概就是半天的量。"
            detailLabel="為什麼"
            detail="股本大的股票成交量本來就大，直接比張數不公平；除過量之後，不同股票才能放在一起比。"
          />
          <Entry
            term="連續性"
            meaning="從最近一天往前數，同一個方向連續買超或賣超了幾天。"
            detail="如果最近一天打平（淨額為 0），算「無連續」。"
          />
        </dl>

        <h3 className="guide__sub-title">聯合狀態</h3>
        <p className="guide__caution">
          以下只是外資與投信方向的並列描述，<strong>不形成綜合評分，也不覆寫技術面結果</strong>。
        </p>
        <dl className="guide__list guide__list--grid">
          <Entry term="外資與投信同買" meaning="這 5 天，外資和投信都是買超。" />
          <Entry term="外資與投信同賣" meaning="這 5 天，外資和投信都是賣超。" />
          <Entry term="外資與投信分歧" meaning="這 5 天，一個買超、一個賣超。" />
          <Entry term="無共識" meaning="這 5 天，有一邊淨額剛好是 0。" />
          <Entry
            term="法人資料未就緒"
            meaning="外資或投信任一邊，資料不到 5 個交易日。"
            detailLabel="為什麼"
            detail="這時不會顯示中性或無共識，畫面會標出最後一次有資料的日期。"
          />
        </dl>
      </section>

      </details>

      <section className="guide__section guide__section--nots" id="nots" aria-label="系統不做什麼">
        <h2 className="guide__section-title">系統不做什麼</h2>
        <ul className="guide__nots">
          <li>不使用盤中價格，所有判讀採最近一個收盤交易日。</li>
          <li>不產生自動交易指令。</li>
          <li>不把 API Key 放進瀏覽器。</li>
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
