import { useLayoutEffect, useRef, useState } from 'react';
import { createMockSSE, type MockSSEControl } from './lib/mockSSE';
import { useStreamingBuffer } from './hooks/useStreamingBuffer';
import { MarkdownItRenderer } from './components/MarkdownItRenderer';

type Status = 'idle' | 'streaming' | 'paused' | 'done';

const SPEEDS = {
  slow: { chunkSize: 2, minDelay: 25, maxDelay: 90, label: '🐢 慢速（易观察补齐）' },
  normal: { chunkSize: 4, minDelay: 10, maxDelay: 45, label: '🚶 正常' },
  fast: { chunkSize: 8, minDelay: 2, maxDelay: 12, label: '⚡ 极速（压测缓冲）' },
} as const;

type SpeedKey = keyof typeof SPEEDS;

const STATUS_LABEL: Record<Status, string> = {
  idle: '未开始',
  streaming: '流式中',
  paused: '已暂停',
  done: '已完成',
};

export default function App() {
  const [throttle, setThrottle] = useState(true);
  const [speed, setSpeed] = useState<SpeedKey>('normal');
  const [status, setStatus] = useState<Status>('idle');
  const [autoScroll, setAutoScroll] = useState(true);
  const [isAtBottom, setIsAtBottom] = useState(true);

  const { state, push, start, finish, reset } = useStreamingBuffer({ throttle });
  const sseRef = useRef<MockSSEControl | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const busy = status === 'streaming';

  const startStream = () => {
    sseRef.current?.cancel();
    start();
    setStatus('streaming');
    setAutoScroll(true);
    const cfg = SPEEDS[speed];
    sseRef.current = createMockSSE({
      onChunk: push,
      onDone: () => {
        finish();
        setStatus('done');
      },
      chunkSize: cfg.chunkSize,
      minDelay: cfg.minDelay,
      maxDelay: cfg.maxDelay,
    });
    sseRef.current.start();
  };

  const pauseStream = () => {
    sseRef.current?.pause();
    setStatus('paused');
  };
  const resumeStream = () => {
    sseRef.current?.resume();
    setStatus('streaming');
  };
  const resetAll = () => {
    sseRef.current?.cancel();
    reset();
    setStatus('idle');
    setAutoScroll(true);
    setIsAtBottom(true);
  };

  // 突发压测：一次性灌入 240 个 chunk，验证 rAF 节流
  const burst = () => {
    if (status !== 'streaming') return;
    const stress = '\n## 突发压测\n\n' + 'x'.repeat(240) + '\n';
    for (const ch of stress) push(ch);
  };

  // 智能锚定滚动：仅在用户处于底部时才跟随
  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
    setIsAtBottom(atBottom);
    if (!atBottom) setAutoScroll(false);
  };

  useLayoutEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      setIsAtBottom(true);
    }
  }, [state.rawText, state.done, autoScroll]);

  const ratio = state.chunksReceived / Math.max(state.framesRendered, 1);
  const ghostLen = state.appended.length;
  const prefix = ghostLen
    ? state.processedText.slice(0, state.processedText.length - ghostLen)
    : state.processedText;
  const suffix = ghostLen ? state.processedText.slice(state.processedText.length - ghostLen) : '';
  const elapsed =
    state.done && state.finishedAt ? state.finishedAt - state.startedAt : 0;

  return (
    <div className="app">
      <header className="app-header">
        <div>
          <h1>
            SSE 流式 Markdown 渲染 <span className="badge">可验证 Demo</span>
          </h1>
          <p className="subtitle">
            数据接收 / 语法解析 / 视图渲染 三层解耦 · 缓冲调度 + 幽灵补齐 + morphdom 局部更新 + 占位符 Portal
          </p>
        </div>
        <div className="status-badge" data-status={status}>
          ● {STATUS_LABEL[status]}
        </div>
      </header>

      <div className="controls">
        <div className="control-group">
          <button className="btn primary" onClick={startStream} disabled={busy}>
            ▶ 开始流式
          </button>
          {status === 'streaming' && (
            <button className="btn" onClick={pauseStream}>
              ⏸ 暂停
            </button>
          )}
          {status === 'paused' && (
            <button className="btn" onClick={resumeStream}>
              ▶ 继续
            </button>
          )}
          <button className="btn" onClick={resetAll}>
            ⏹ 重置
          </button>
          <button className="btn warn" onClick={burst} disabled={status !== 'streaming'}>
            🔥 突发压测 240 chunk
          </button>
        </div>

        <div className="control-group">
          <label className="toggle">
            <input
              type="checkbox"
              checked={throttle}
              onChange={(e) => setThrottle(e.target.checked)}
              disabled={busy}
            />
            <span>rAF 节流 {throttle ? '开' : '关'}</span>
          </label>
          <label className="field">
            <span>速度</span>
            <select
              value={speed}
              onChange={(e) => setSpeed(e.target.value as SpeedKey)}
              disabled={busy}
            >
              {(Object.keys(SPEEDS) as SpeedKey[]).map((k) => (
                <option key={k} value={k}>
                  {SPEEDS[k].label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="metrics">
        <Metric label="SSE chunk 数" value={String(state.chunksReceived)} />
        <Metric label="解析/渲染次数" value={String(state.framesRendered)} />
        <Metric
          label="节流比 (chunk/次)"
          value={ratio.toFixed(1)}
          tone={throttle && ratio > 2 ? 'good' : 'neutral'}
        />
        <Metric
          label="幽灵补齐耗时"
          value={`${state.phantomMs.toFixed(2)} ms`}
          tone={state.phantomMs > 16 ? 'bad' : state.phantomMs > 8 ? 'warn' : 'good'}
        />
        <Metric
          label="markdown-it 解析"
          value={`${state.mdMs.toFixed(2)} ms`}
          tone={state.mdMs > 16 ? 'bad' : 'good'}
        />
        <Metric label="缓冲队列" value={String(state.bufferSize)} />
        <Metric label="总耗时" value={elapsed ? `${(elapsed / 1000).toFixed(1)} s` : '—'} />
      </div>

      <main className="grid">
        <section className="panel">
          <h2>🔮 幽灵补齐（预处理层）</h2>
          <div className="ghost-chips">
            {state.closed.length === 0 ? (
              <span className="muted">✅ 无未闭合标记，文本已平衡</span>
            ) : (
              state.closed.map((c, i) => (
                <span key={i} className="chip ghost">
                  临时补齐 {c}
                </span>
              ))
            )}
          </div>
          <div className="panel-section">
            <h3>
              原始累积文本（Buffer 全量）<span className="mini">长度 {state.rawText.length}</span>
            </h3>
            <pre className="code-view">{state.rawText || '（等待数据…）'}</pre>
          </div>
          <div className="panel-section">
            <h3>预处理后（幽灵补齐已高亮）</h3>
            <pre className="code-view">
              {prefix}
              <span className="ghost-highlight">{suffix}</span>
            </pre>
          </div>
        </section>

        <section className="panel output-panel">
          <div className="output-toolbar">
            <h2>
              📄 渲染结果{' '}
              <span className={`mode-badge ${state.done ? 'done' : 'streaming'}`}>
                {state.done ? 'markdown-it · 已完成' : 'markdown-it · 流式中'}
              </span>
            </h2>
            <div className="scroll-controls">
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={autoScroll}
                  onChange={(e) => setAutoScroll(e.target.checked)}
                />
                <span>自动跟随</span>
              </label>
              <span className={`anchor ${isAtBottom ? '' : 'off'}`}>
                {isAtBottom ? '📌 已在底部' : '✋ 用户正在阅读，不跟随'}
              </span>
              {!autoScroll && (
                <button className="btn small" onClick={() => setAutoScroll(true)}>
                  ⬇ 回到底部
                </button>
              )}
            </div>
          </div>

          <div ref={scrollRef} className="scroll-area" onScroll={handleScroll}>
            <MarkdownItRenderer html={state.html} />
          </div>

          <p className="hint">
            {state.done
              ? 'SSE 已结束。全程使用 markdown-it + morphdom 局部更新：文本可稳定选中、图表组件已通过 Portal 注入并可交互。'
              : 'markdown-it 产出 HTML 字符串 → morphdom 算出差异只更新变化的文本节点（保留选区/滚动）→ 占位符 <div> 由 createPortal 注入真实 React 组件。'}
          </p>
        </section>
      </main>

      <section className="panel checklist">
        <h2>✅ 如何验证这套架构</h2>
        <ol>
          <li>
            <b>rAF 节流：</b>观察「SSE chunk 数」远大于「解析/渲染次数」；点击「突发压测」一次灌入 240
            chunk，节流比 ≈ 240。关闭 rAF 节流再压测会明显卡顿。
          </li>
          <li>
            <b>幽灵补齐：</b>流式过程中（建议慢速），观察左侧「预处理后」文本末尾高亮的临时闭合标记（**
            / ` / ``` / ](#)），它们随真实标记到来而自动消失。
          </li>
          <li>
            <b>代码块不误补：</b>代码块内的字面量 `**` 与反引号被正确跳过，不会触发幽灵补齐。
          </li>
          <li>
            <b>表格幽灵补齐（不突变）：</b>表格表头一出现（≥2 列），预处理器就临时补一行幽灵分隔行，
            表格从「第二列出现」那一刻起就锁定为 <code>&lt;table&gt;</code>，不会再回退成段落——
            左侧「幽灵补齐」区会显示「表格幽灵补齐 ×N列」。
          </li>
          <li>
            <b>组件交互（Portal）：</b>图表占位符 `$$CHART_001$$` 到达后，markdown-it 渲染出
            <code>{'<div id="slot-CHART_001">'}</code>，ReactDOM.createPortal 把图表组件“塞”进去；
            流式期间即可点击，且组件渲染次数始终 ≈ 1（React.memo）。
          </li>
          <li>
            <b>morphdom 局部更新：</b>流式中尝试用鼠标选中已渲染的文字——morphdom 只更新变化的文本节点，
            选区不会丢失（对比 innerHTML 全量替换会丢选区、丢滚动位置）。
          </li>
          <li>
            <b>智能滚动：</b>向上滚动后停止跟随（显示「用户正在阅读」），点击「回到底部」恢复跟随。
          </li>
        </ol>
      </section>
    </div>
  );
}

function Metric({
  label,
  value,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  tone?: 'good' | 'warn' | 'bad' | 'neutral';
}) {
  return (
    <div className="metric" data-tone={tone}>
      <span className="metric-label">{label}</span>
      <span className="metric-value">{value}</span>
    </div>
  );
}
