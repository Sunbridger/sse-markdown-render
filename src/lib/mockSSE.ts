import { FULL_TEXT } from './content';

export interface MockSSEOptions {
  onChunk: (chunk: string) => void;
  onDone: () => void;
  chunkSize?: number;
  minDelay?: number;
  maxDelay?: number;
}

export interface MockSSEControl {
  start: () => void;
  pause: () => void;
  resume: () => void;
  cancel: () => void;
  readonly progress: number;
}

/**
 * 模拟 SSE 源：按字符块 + 随机抖动延迟推送，验证缓冲调度层。
 * 真实场景中，这里替换成 EventSource / fetch 的 ReadableStream 即可。
 */
export function createMockSSE(opts: MockSSEOptions): MockSSEControl {
  const { onChunk, onDone, chunkSize = 4, minDelay = 10, maxDelay = 45 } = opts;
  let paused = false;
  let cancelled = false;
  let index = 0;
  let timer: number | null = null;

  const step = () => {
    if (cancelled || paused) return;
    if (index >= FULL_TEXT.length) {
      onDone();
      return;
    }
    const chunk = FULL_TEXT.slice(index, index + chunkSize);
    index += chunkSize;
    onChunk(chunk);
    const delay = minDelay + Math.random() * (maxDelay - minDelay);
    timer = window.setTimeout(step, delay);
  };

  return {
    start() {
      cancelled = false;
      paused = false;
      index = 0;
      step();
    },
    pause() {
      paused = true;
      if (timer !== null) window.clearTimeout(timer);
      timer = null;
    },
    resume() {
      if (!paused) return;
      paused = false;
      step();
    },
    cancel() {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
      timer = null;
    },
    get progress() {
      return index / FULL_TEXT.length;
    },
  };
}
