const SR_STEPS = [
  '先看有沒有庫存，沒有的話不執行，也不連網。',
  '讀取本機已存的股價、法人買賣超、除權息與分割資料。',
  '把配息與分割的帳面影響還原回去。',
  '技術面：算 5／20／60 日均線；股價不到 60 筆顯示資料不足。',
  '技術面：算乖離率，判斷月線狀態與回穩。',
  '技術面：跌破月線或連兩天在季線下面，發出風險提醒。',
  '籌碼面：統計外資、投信近 5 日買賣超；任一邊不到 5 個交易日顯示未就緒。',
  '籌碼面：算強度、連續性與聯合狀態。',
  '技術面與籌碼面並排顯示，不合併成單一分數。',
];

export function CalculationFlow() {
  return (
    <div className="flow">
      <p className="flow__lede">
        完整分析的每一檔股票都照這個順序計算。名詞定義請看<strong>系統怎麼算</strong>。
      </p>

      <div className="flowchart__scroll">
      <svg
        className="flowchart"
        style={{ width: 720 }}
        viewBox="0 0 720 620"
        role="img"
        aria-labelledby="flow-title"
      >
        <title id="flow-title">
          計算流程圖：讀取資料並還原權息後，技術面與籌碼面分開計算，各自檢查資料是否足夠，最後並排顯示、不合併。
        </title>
        <defs>
          <marker
            id="flowArrow"
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M0,0 L10,5 L0,10 z" className="flowchart__arrowhead" />
          </marker>
        </defs>

        {/* 有庫存？ */}
        <polygon
          className="flowchart__decision"
          points="360,6 440,32 360,58 280,32"
        />
        <text x="360" y="36" className="flowchart__label" textAnchor="middle">
          有庫存？
        </text>

        <line
          x1="280"
          y1="32"
          x2="229"
          y2="32"
          className="flowchart__edge"
          markerEnd="url(#flowArrow)"
        />
        <text x="252" y="22" className="flowchart__gate-label" textAnchor="middle">
          否
        </text>
        <g className="flowchart__terminal--quiet">
          <rect x="55" y="14" width="170" height="36" />
          <text x="140" y="36" className="flowchart__terminal-text" textAnchor="middle">
            不執行，不連網
          </text>
        </g>

        <line
          x1="360"
          y1="58"
          x2="360"
          y2="83"
          className="flowchart__edge"
          markerEnd="url(#flowArrow)"
        />

        {/* 讀取本機資料 */}
        <rect x="250" y="86" width="220" height="40" className="flowchart__node" />
        <text x="360" y="110" className="flowchart__node-text" textAnchor="middle">
          讀取本機已存的資料
        </text>

        <line
          x1="360"
          y1="126"
          x2="360"
          y2="143"
          className="flowchart__edge"
          markerEnd="url(#flowArrow)"
        />

        {/* 還原權息與分割 */}
        <rect x="240" y="146" width="240" height="40" className="flowchart__node" />
        <text x="360" y="170" className="flowchart__node-text" textAnchor="middle">
          還原權息與分割
        </text>

        {/* 分流：技術面 / 籌碼面 */}
        <path
          d="M360,186 L360,196 L200,196 L200,217"
          className="flowchart__edge"
          markerEnd="url(#flowArrow)"
        />
        <path
          d="M360,186 L360,196 L520,196 L520,217"
          className="flowchart__edge"
          markerEnd="url(#flowArrow)"
        />

        {/* ── 技術面 ── */}
        <rect x="115" y="220" width="170" height="52" className="flowchart__node" />
        <text x="200" y="236" className="flowchart__eyebrow" textAnchor="middle">
          技術面
        </text>
        <text x="200" y="255" className="flowchart__node-text" textAnchor="middle">
          算三條均線
        </text>

        <line
          x1="200"
          y1="272"
          x2="200"
          y2="289"
          className="flowchart__edge"
          markerEnd="url(#flowArrow)"
        />

        <polygon
          className="flowchart__decision"
          points="200,292 264,316 200,340 136,316"
        />
        <text x="200" y="320" className="flowchart__label" textAnchor="middle">
          ≥60 筆？
        </text>

        <line
          x1="136"
          y1="316"
          x2="118"
          y2="316"
          className="flowchart__edge"
          markerEnd="url(#flowArrow)"
        />
        <text x="127" y="306" className="flowchart__gate-label" textAnchor="middle">
          否
        </text>
        <g className="flowchart__terminal--attention">
          <rect x="5" y="296" width="113" height="40" />
          <text x="61" y="320" className="flowchart__terminal-text" textAnchor="middle">
            資料不足
          </text>
        </g>

        <line
          x1="200"
          y1="340"
          x2="200"
          y2="359"
          className="flowchart__edge"
          markerEnd="url(#flowArrow)"
        />

        <rect x="115" y="362" width="170" height="36" className="flowchart__node" />
        <text x="200" y="384" className="flowchart__node-text" textAnchor="middle">
          算乖離率
        </text>

        <line
          x1="200"
          y1="398"
          x2="200"
          y2="413"
          className="flowchart__edge"
          markerEnd="url(#flowArrow)"
        />

        <rect x="115" y="416" width="170" height="40" className="flowchart__node" />
        <text x="200" y="440" className="flowchart__node-text" textAnchor="middle">
          月線狀態／回穩
        </text>

        <line
          x1="200"
          y1="456"
          x2="200"
          y2="469"
          className="flowchart__edge"
          markerEnd="url(#flowArrow)"
        />

        <rect x="115" y="472" width="170" height="46" className="flowchart__node" />
        <text x="200" y="490" className="flowchart__node-text" textAnchor="middle">
          風險提醒
        </text>
        <text x="200" y="505" className="flowchart__node-subtext" textAnchor="middle">
          回檔觀察／趨勢轉弱
        </text>

        <line
          x1="200"
          y1="518"
          x2="200"
          y2="537"
          className="flowchart__edge"
          markerEnd="url(#flowArrow)"
        />

        {/* ── 籌碼面 ── */}
        <rect x="435" y="220" width="170" height="52" className="flowchart__node" />
        <text x="520" y="236" className="flowchart__eyebrow" textAnchor="middle">
          籌碼面
        </text>
        <text x="520" y="255" className="flowchart__node-text" textAnchor="middle">
          統計買賣超
        </text>

        <line
          x1="520"
          y1="272"
          x2="520"
          y2="289"
          className="flowchart__edge"
          markerEnd="url(#flowArrow)"
        />

        <polygon
          className="flowchart__decision"
          points="520,292 576,316 520,340 464,316"
        />
        <text x="520" y="320" className="flowchart__label" textAnchor="middle">
          雙方≥5日？
        </text>

        <line
          x1="576"
          y1="316"
          x2="594"
          y2="316"
          className="flowchart__edge"
          markerEnd="url(#flowArrow)"
        />
        <text x="585" y="306" className="flowchart__gate-label" textAnchor="middle">
          否
        </text>
        <g className="flowchart__terminal--attention">
          <rect x="597" y="296" width="118" height="40" />
          <text x="656" y="320" className="flowchart__terminal-text" textAnchor="middle">
            法人未就緒
          </text>
        </g>

        <line
          x1="520"
          y1="340"
          x2="520"
          y2="359"
          className="flowchart__edge"
          markerEnd="url(#flowArrow)"
        />

        <rect x="435" y="362" width="170" height="48" className="flowchart__node" />
        <text x="520" y="381" className="flowchart__node-text" textAnchor="middle">
          強度／連續性
        </text>
        <text x="520" y="397" className="flowchart__node-subtext" textAnchor="middle">
          聯合狀態
        </text>

        <line
          x1="520"
          y1="410"
          x2="520"
          y2="537"
          className="flowchart__edge"
          markerEnd="url(#flowArrow)"
        />

        {/* 並排顯示，不合併 */}
        <rect x="110" y="540" width="500" height="64" className="flowchart__converge" />
        <line x1="360" y1="540" x2="360" y2="582" className="flowchart__divider" />
        <line x1="110" y1="582" x2="610" y2="582" className="flowchart__divider" />
        <text x="235" y="565" className="flowchart__node-text" textAnchor="middle">
          技術面結果
        </text>
        <text x="485" y="565" className="flowchart__node-text" textAnchor="middle">
          籌碼面結果
        </text>
        <text x="360" y="597" className="flowchart__terminal-text" textAnchor="middle">
          並排顯示，不合併為單一分數
        </text>
      </svg>
      </div>

      <ol className="sr-only">
        {SR_STEPS.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
    </div>
  );
}
