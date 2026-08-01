const SR_STEPS = [
  '辨識建立部位，排除加碼、再進場與現沖。',
  '回補歷史資料，並把每筆資料截斷到進場日，避免用到進場之後才有的資訊。',
  '算出進場當日的指標值、買進後的報酬，以及個人基準中位數。',
  'walk-forward：訓練期算出 P25／P75 門檻，驗證期用門檻分類；同時用每組門檻重新分類，找出歸屬會改變的翻轉樣本。',
  '回檔下界、合理區、偏熱上界，三個候選區間各自套用同一套判定：',
  '完整驗證事件不到 5 筆，判為資料不足。',
  '5 到 9 筆，判為初步觀察，尚不足以採納。',
  '10 筆以上，但跨檢查點不到 2 個，判為證據不足。',
  '中位數低於同類基準，判為證據不足。',
  '排除翻轉樣本後樣本太少或中位數轉為低於基準，判為門檻不穩定。',
  '排除重疊樣本後樣本太少或中位數轉為低於基準，判為重疊敏感。',
  '兩種排除後同時清白的樣本太少，依排除較多的一方判為門檻不穩定或重疊敏感。',
  '通過以上所有檢查，判為值得繼續追蹤。',
];

export function ResearchFlow() {
  return (
    <div className="flow">
      <p className="flow__lede">
        每個候選區間的證據等級，都是照這個順序算出來的。名詞定義請看<strong>判讀說明</strong>。
      </p>

      <div className="flowchart__scroll">
        <svg
          className="flowchart"
          style={{ width: 640 }}
          viewBox="0 0 640 744"
          role="img"
          aria-labelledby="research-flow-title"
        >
          <title id="research-flow-title">
            計算流程圖：辨識建立部位、回補並截斷到進場日、算出指標與報酬後，用
            walk-forward
            切出門檻並分類，三個候選區間各自通過一連串門檻檢查，最後判定證據等級。
          </title>
          <defs>
            <marker
              id="researchFlowArrow"
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

          {/* 建立部位辨識 */}
          <rect x="110" y="10" width="300" height="44" className="flowchart__node" />
          <text x="260" y="28" className="flowchart__node-text" textAnchor="middle">
            建立部位辨識
          </text>
          <text x="260" y="44" className="flowchart__node-subtext" textAnchor="middle">
            排除加碼／再進場／現沖
          </text>

          <line
            x1="260"
            y1="54"
            x2="260"
            y2="67"
            className="flowchart__edge"
            markerEnd="url(#researchFlowArrow)"
          />

          {/* 回補歷史資料＋無前視快照 */}
          <rect x="110" y="68" width="300" height="44" className="flowchart__node" />
          <text x="260" y="86" className="flowchart__node-text" textAnchor="middle">
            回補歷史資料＋無前視快照
          </text>
          <text x="260" y="102" className="flowchart__node-subtext" textAnchor="middle">
            只用進場日以前的資料
          </text>

          <line
            x1="260"
            y1="112"
            x2="260"
            y2="125"
            className="flowchart__edge"
            markerEnd="url(#researchFlowArrow)"
          />

          {/* 算指標與買進後報酬 */}
          <rect x="110" y="126" width="300" height="44" className="flowchart__node" />
          <text x="260" y="144" className="flowchart__node-text" textAnchor="middle">
            算進場當日指標與買進後報酬
          </text>
          <text x="260" y="160" className="flowchart__node-subtext" textAnchor="middle">
            個人基準／重疊偵測
          </text>

          <line
            x1="260"
            y1="170"
            x2="260"
            y2="183"
            className="flowchart__edge"
            markerEnd="url(#researchFlowArrow)"
          />

          {/* walk-forward 切點 */}
          <rect x="110" y="184" width="300" height="44" className="flowchart__node" />
          <text x="260" y="202" className="flowchart__node-text" textAnchor="middle">
            walk-forward 切點
          </text>
          <text x="260" y="218" className="flowchart__node-subtext" textAnchor="middle">
            算門檻、分類、找出翻轉樣本
          </text>

          <line
            x1="260"
            y1="228"
            x2="260"
            y2="257"
            className="flowchart__edge"
            markerEnd="url(#researchFlowArrow)"
          />
          <text x="280" y="238" className="flowchart__gate-label" textAnchor="start">
            三個候選區間
          </text>
          <text x="280" y="250" className="flowchart__gate-label" textAnchor="start">
            各自套用下方判定
          </text>

          {/* D1 */}
          <polygon className="flowchart__decision" points="260,258 360,282 260,306 160,282" />
          <text x="260" y="286" className="flowchart__label" textAnchor="middle">
            完整驗證事件 ≥5？
          </text>
          <line
            x1="360"
            y1="282"
            x2="429"
            y2="282"
            className="flowchart__edge"
            markerEnd="url(#researchFlowArrow)"
          />
          <text x="395" y="272" className="flowchart__gate-label" textAnchor="middle">
            否
          </text>
          <g className="flowchart__terminal--attention">
            <rect x="432" y="264" width="200" height="36" />
            <text x="532" y="286" className="flowchart__terminal-text" textAnchor="middle">
              資料不足
            </text>
          </g>

          <line
            x1="260"
            y1="306"
            x2="260"
            y2="319"
            className="flowchart__edge"
            markerEnd="url(#researchFlowArrow)"
          />

          {/* D2 */}
          <polygon className="flowchart__decision" points="260,320 360,344 260,368 160,344" />
          <text x="260" y="348" className="flowchart__label" textAnchor="middle">
            同樣 ≥10？
          </text>
          <line
            x1="360"
            y1="344"
            x2="429"
            y2="344"
            className="flowchart__edge"
            markerEnd="url(#researchFlowArrow)"
          />
          <text x="395" y="334" className="flowchart__gate-label" textAnchor="middle">
            否
          </text>
          <g className="flowchart__terminal--attention">
            <rect x="432" y="326" width="200" height="36" />
            <text x="532" y="348" className="flowchart__terminal-text" textAnchor="middle">
              初步觀察
            </text>
          </g>

          <line
            x1="260"
            y1="368"
            x2="260"
            y2="381"
            className="flowchart__edge"
            markerEnd="url(#researchFlowArrow)"
          />

          {/* D3 */}
          <polygon className="flowchart__decision" points="260,382 360,406 260,430 160,406" />
          <text x="260" y="410" className="flowchart__label" textAnchor="middle">
            跨 ≥2 個檢查點？
          </text>
          <line
            x1="360"
            y1="406"
            x2="429"
            y2="406"
            className="flowchart__edge"
            markerEnd="url(#researchFlowArrow)"
          />
          <text x="395" y="396" className="flowchart__gate-label" textAnchor="middle">
            否
          </text>
          <g className="flowchart__terminal--attention">
            <rect x="432" y="384" width="200" height="44" />
            <text x="532" y="402" className="flowchart__terminal-text" textAnchor="middle">
              證據不足
            </text>
            <text x="532" y="417" className="flowchart__node-subtext" textAnchor="middle">
              檢查點不足
            </text>
          </g>

          <line
            x1="260"
            y1="430"
            x2="260"
            y2="443"
            className="flowchart__edge"
            markerEnd="url(#researchFlowArrow)"
          />

          {/* D4 */}
          <polygon className="flowchart__decision" points="260,444 360,468 260,492 160,468" />
          <text x="260" y="472" className="flowchart__label" textAnchor="middle">
            中位數 ≥ 同類基準？
          </text>
          <line
            x1="360"
            y1="468"
            x2="429"
            y2="468"
            className="flowchart__edge"
            markerEnd="url(#researchFlowArrow)"
          />
          <text x="395" y="458" className="flowchart__gate-label" textAnchor="middle">
            否
          </text>
          <g className="flowchart__terminal--attention">
            <rect x="432" y="446" width="200" height="44" />
            <text x="532" y="464" className="flowchart__terminal-text" textAnchor="middle">
              證據不足
            </text>
            <text x="532" y="479" className="flowchart__node-subtext" textAnchor="middle">
              低於基準
            </text>
          </g>

          <line
            x1="260"
            y1="492"
            x2="260"
            y2="505"
            className="flowchart__edge"
            markerEnd="url(#researchFlowArrow)"
          />

          {/* D5 */}
          <polygon className="flowchart__decision" points="260,506 360,530 260,554 160,530" />
          <text x="260" y="527" className="flowchart__label" textAnchor="middle">
            排除翻轉樣本後
          </text>
          <text x="260" y="539" className="flowchart__label" textAnchor="middle">
            仍達標？
          </text>
          <line
            x1="360"
            y1="530"
            x2="429"
            y2="530"
            className="flowchart__edge"
            markerEnd="url(#researchFlowArrow)"
          />
          <text x="395" y="520" className="flowchart__gate-label" textAnchor="middle">
            否
          </text>
          <g className="flowchart__terminal--attention">
            <rect x="432" y="508" width="200" height="44" />
            <text x="532" y="526" className="flowchart__terminal-text" textAnchor="middle">
              門檻不穩定
            </text>
            <text x="532" y="541" className="flowchart__node-subtext" textAnchor="middle">
              排除翻轉後樣本不足或低於基準
            </text>
          </g>

          <line
            x1="260"
            y1="554"
            x2="260"
            y2="567"
            className="flowchart__edge"
            markerEnd="url(#researchFlowArrow)"
          />

          {/* D6 */}
          <polygon className="flowchart__decision" points="260,568 360,592 260,616 160,592" />
          <text x="260" y="589" className="flowchart__label" textAnchor="middle">
            排除重疊樣本後
          </text>
          <text x="260" y="601" className="flowchart__label" textAnchor="middle">
            仍達標？
          </text>
          <line
            x1="360"
            y1="592"
            x2="429"
            y2="592"
            className="flowchart__edge"
            markerEnd="url(#researchFlowArrow)"
          />
          <text x="395" y="582" className="flowchart__gate-label" textAnchor="middle">
            否
          </text>
          <g className="flowchart__terminal--attention">
            <rect x="432" y="570" width="200" height="44" />
            <text x="532" y="588" className="flowchart__terminal-text" textAnchor="middle">
              重疊敏感
            </text>
            <text x="532" y="603" className="flowchart__node-subtext" textAnchor="middle">
              排除重疊後樣本不足或低於基準
            </text>
          </g>

          <line
            x1="260"
            y1="616"
            x2="260"
            y2="629"
            className="flowchart__edge"
            markerEnd="url(#researchFlowArrow)"
          />

          {/* D7 */}
          <polygon className="flowchart__decision" points="260,630 360,654 260,678 160,654" />
          <text x="260" y="651" className="flowchart__label" textAnchor="middle">
            兩者皆清的樣本
          </text>
          <text x="260" y="663" className="flowchart__label" textAnchor="middle">
            {'>'}4 筆？
          </text>
          <line
            x1="360"
            y1="654"
            x2="429"
            y2="654"
            className="flowchart__edge"
            markerEnd="url(#researchFlowArrow)"
          />
          <text x="395" y="644" className="flowchart__gate-label" textAnchor="middle">
            否
          </text>
          <g className="flowchart__terminal--attention">
            <rect x="432" y="632" width="200" height="44" />
            <text x="532" y="650" className="flowchart__terminal-text" textAnchor="middle">
              門檻不穩定／重疊敏感
            </text>
            <text x="532" y="665" className="flowchart__node-subtext" textAnchor="middle">
              取排除較多的一方
            </text>
          </g>

          <line
            x1="260"
            y1="678"
            x2="260"
            y2="691"
            className="flowchart__edge"
            markerEnd="url(#researchFlowArrow)"
          />

          {/* 值得繼續追蹤：與其餘證據等級一致，維持中性墨色而非綠色 */}
          <rect x="160" y="692" width="200" height="40" className="flowchart__node" />
          <text x="260" y="716" className="flowchart__node-text" textAnchor="middle">
            值得繼續追蹤
          </text>
        </svg>
      </div>

      <p className="flow__lede">
        判定結果對應「研究結果」分頁每個候選區間右上角的證據等級標籤。
      </p>

      <ol className="sr-only">
        {SR_STEPS.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
    </div>
  );
}
