import { memo, useRef, useState } from 'react';

interface ChartProps {
  id: string;
}

/**
 * 自定义可交互组件（React.memo 包裹）。
 * 通过 Portal 注入 markdown-it 渲染出的 <div id="slot-..."> 占位符里。
 * 流式全程可用，且因 props 不变 + memo，不会随文本更新而重渲染。
 */
function ChartInner({ id }: ChartProps) {
  const [data, setData] = useState<number[]>([42, 68, 33, 80, 55]);
  const [clicks, setClicks] = useState(0);
  const renderCount = useRef(0);
  renderCount.current += 1;

  return (
    <div className="chart-card">
      <div className="chart-head">
        <strong>📊 交互图表 {id}</strong>
        <span className="chart-meta">组件渲染 {renderCount.current} 次 · 交互 {clicks} 次</span>
      </div>
      <div className="chart-bars">
        {data.map((v, i) => (
          <div key={i} className="chart-bar" style={{ height: `${v}%` }}>
            <span className="chart-bar-val">{v}</span>
          </div>
        ))}
      </div>
      <div className="chart-actions">
        <button
          type="button"
          onClick={() => {
            setData(data.map(() => 15 + Math.round(Math.random() * 85)));
            setClicks((c) => c + 1);
          }}
        >
          随机数据
        </button>
        <button
          type="button"
          onClick={() => {
            setData([42, 68, 33, 80, 55]);
            setClicks((c) => c + 1);
          }}
        >
          重置
        </button>
      </div>
      <p className="chart-note">流式过程中即可点击交互；因 React.memo，文本更新不会重渲染此组件。</p>
    </div>
  );
}

export const Chart = memo(ChartInner);
