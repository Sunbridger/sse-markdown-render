import { useCallback, useEffect, useRef, useState } from 'react';
import { md } from '../lib/markdownIt';
import { phantomClose, replaceCharts } from '../lib/phantomClose';

export interface StreamState {
  rawText: string;
  processedText: string;
  html: string;
  closed: string[];
  appended: string;
  chunksReceived: number;
  framesRendered: number;
  bufferSize: number;
  phantomMs: number;
  mdMs: number;
  done: boolean;
  startedAt: number;
  finishedAt: number | null;
}

const INITIAL: StreamState = {
  rawText: '',
  processedText: '',
  html: '',
  closed: [],
  appended: '',
  chunksReceived: 0,
  framesRendered: 0,
  bufferSize: 0,
  phantomMs: 0,
  mdMs: 0,
  done: false,
  startedAt: 0,
  finishedAt: null,
};

/**
 * 缓冲调度层 + 预处理稳定层。
 *
 * SSE chunk 只进入内存 Buffer，由 requestAnimationFrame 每帧取出累积的
 * 全量字符串，做幽灵补齐后用 markdown-it 一次性渲染成 HTML 字符串。
 *
 * 关键点：rAF 是唯一的渲染节拍器 —— 无论后端吐多少个 chunk，
 * 每帧最多做一次「补齐 + 解析」，从而把渲染频率锁死在 ~60fps。
 */
export function useStreamingBuffer(opts: { throttle: boolean }) {
  const { throttle } = opts;
  const [state, setState] = useState<StreamState>(INITIAL);
  const bufferRef = useRef<string[]>([]);
  const rawRef = useRef('');
  const doneRef = useRef(false);

  const flush = useCallback(() => {
    if (doneRef.current) return;
    const pending = bufferRef.current;
    if (pending.length === 0) return;
    bufferRef.current = [];
    rawRef.current += pending.join('');
    const raw = rawRef.current;

    // 预处理：幽灵补齐未闭合标记
    const t0 = performance.now();
    const { text, closed, appended } = phantomClose(raw);
    const phantomMs = performance.now() - t0;

    // 解析：占位符 → HTML 字符串（markdown-it）
    const t1 = performance.now();
    const html = md.render(replaceCharts(text));
    const mdMs = performance.now() - t1;

    setState((s) => ({
      ...s,
      rawText: raw,
      processedText: text,
      html,
      closed,
      appended,
      phantomMs,
      mdMs,
      framesRendered: s.framesRendered + 1,
      bufferSize: 0,
    }));
  }, []);

  // rAF 消费循环：每帧把 Buffer 里累积的 chunk 一次性消费掉
  useEffect(() => {
    if (!throttle) return;
    let raf = 0;
    const loop = () => {
      flush();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [throttle, flush]);

  const push = useCallback(
    (chunk: string) => {
      if (doneRef.current) return;
      bufferRef.current.push(chunk);
      setState((s) => ({
        ...s,
        chunksReceived: s.chunksReceived + 1,
        bufferSize: bufferRef.current.length,
      }));
      // 关闭节流时：每来一个 chunk 立即解析（对照实验，用于观察卡顿）
      if (!throttle) flush();
    },
    [throttle, flush]
  );

  const start = useCallback(() => {
    bufferRef.current = [];
    rawRef.current = '';
    doneRef.current = false;
    setState({ ...INITIAL, startedAt: performance.now() });
  }, []);

  const finish = useCallback(() => {
    flush();
    doneRef.current = true;
    setState((s) => ({ ...s, done: true, finishedAt: performance.now() }));
  }, [flush]);

  const reset = useCallback(() => {
    bufferRef.current = [];
    rawRef.current = '';
    doneRef.current = false;
    setState(INITIAL);
  }, []);

  return { state, push, start, finish, reset };
}
