import { createPortal } from 'react-dom';
import { useLayoutEffect, useRef, useState } from 'react';
import morphdom from 'morphdom';
import { Chart } from './Chart';

/**
 * markdown-it 渲染层（流式与终态共用同一个引擎）。
 *
 * 不做 innerHTML 全量替换，而是用 morphdom 做 DOM Diff：
 * 只更新发生变化的文本节点，从而保留选区 / 滚动 / 交互状态。
 *
 * 自定义组件：markdown-it 只输出 <div id="slot-..."> 占位符，
 * 这里用 createPortal 把真实 React 组件“传送”进去。
 */
export function MarkdownItRenderer({ html }: { html: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [slots, setSlots] = useState<Record<string, HTMLElement>>({});

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    // 包裹一层单一根节点，让 morphdom 处理 markdown 的多根 HTML 片段
    morphdom(el, `<div class="md-body">${html}</div>`, {
      // 占位符 div 由 React Portal 管理，morphdom 不要动它（否则会清掉已注入的组件）
      onBeforeElUpdated: (fromEl) => {
        if (fromEl.hasAttribute('data-slot')) return false;
        return true;
      },
    });

    // 每次 diff 后，重新发现占位符并把 React 组件传送进去
    const found: Record<string, HTMLElement> = {};
    el.querySelectorAll<HTMLElement>('[data-slot]').forEach((n) => {
      const id = n.getAttribute('data-slot');
      if (id) found[id] = n;
    });
    setSlots(found);
  }, [html]);

  return (
    <>
      <div ref={containerRef} className="md-body" />
      {Object.entries(slots).map(([id, el]) =>
        createPortal(<Chart id={id} />, el)
      )}
    </>
  );
}
