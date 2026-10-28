export interface PhantomResult {
  /** 幽灵补齐 + 占位符替换后的最终文本 */
  text: string;
  /** 本次临时补上的闭合标记（用于可视化展示） */
  closed: string[];
  /** 实际追加到末尾的幽灵闭合字符串（'' 表示无） */
  appended: string;
}

const CHART_RE = /\$\$(CHART_\d+)\$\$/g;

/**
 * 把自定义组件占位符 $$CHART_xxx$$ 替换为普通 HTML 占位 <div>。
 * markdown-it 渲染该 div，随后由 ReactDOM.createPortal 把真实 React 组件“塞”进去。
 */
export function replaceCharts(src: string): string {
  return src.replace(CHART_RE, (_m, id: string) => `<div id="slot-${id}" data-slot="${id}"></div>`);
}

function count(src: string, re: RegExp): number {
  return (src.match(re) || []).length;
}

/** 剔除已闭合的代码块内容，避免把代码里的字面量 ** / ` 误判为语法标记 */
function stripFences(src: string): string {
  const out: string[] = [];
  let inFence = false;
  for (const line of src.split('\n')) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (!inFence) out.push(line);
  }
  return out.join('\n');
}

/* ---------------------- 表格幽灵补齐 ---------------------- */

/** 分隔行片段：整行只含 | - : 空格（允许 `|`、`-`、`| ---` 等未完成状态） */
function isSeparatorFragment(line: string): boolean {
  const t = line.trim();
  return t !== '' && /^[\s|:\-]+$/.test(t);
}

/** 表头列数：去掉首尾竖线后按 | 分割。对「没写完的表头」也能正确数出列数。 */
function headerColumns(line: string): number {
  const body = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return body.split('|').length;
}

/** 表头行（含未写完状态）：以 | 开头、非分隔行、且列数 >= 2 */
function isHeaderLine(line: string): boolean {
  const t = line.trim();
  if (!t.startsWith('|')) return false;
  if (isSeparatorFragment(t)) return false;
  return headerColumns(t) >= 2;
}

/** 表格上下文行：分隔行片段 或 表头/数据行 */
function isTableContextLine(line: string): boolean {
  const t = line.trim();
  if (isSeparatorFragment(t)) return true;
  return isHeaderLine(t);
}

/** 完整分隔行：语法合法且「单元格数量」与表头一致，markdown-it 才会真正把它当表格 */
function isCompleteSeparator(line: string, columnCount: number): boolean {
  if (!isSeparatorFragment(line) || !line.includes('-')) return false;
  const cells = line
    .split('|')
    .map((c) => c.trim())
    .filter((c) => c !== '');
  if (!cells.every((c) => /^:?-+:?$/.test(c))) return false;
  return cells.length === columnCount;
}

/**
 * 表格幽灵补齐（解决 <p> → <table> 结构突变）。
 *
 * markdown 表格需要「表头行 + 分隔行」同时存在才会被识别为 table。
 * 流式过程中，从表头第一个字符到分隔行补全的这段时间里，markdown-it 会把
 * 半成品表格渲染成段落；分隔行一补全，节点瞬间从 <p> 突变成 <table>，造成高度跳动。
 *
 * 低成本解法：把幽灵补齐哲学延伸到块级表格 ——
 * 只要文本末尾出现了「>=2 列的表头（哪怕还没写完）」，就临时补全表头结尾竖线 +
 * 一行完整幽灵分隔行，让表格从第二列出现那一刻起就稳定为 <table>。
 * 真实分隔行补全后只是替换，结构不再突变，也不会再回退成段落。
 */
function ghostCloseTable(src: string): { text: string; ghost: string; columns: number } | null {
  const lines = src.split('\n');

  // 最后一个非空行
  let lastIdx = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].trim() !== '') {
      lastIdx = i;
      break;
    }
  }
  if (lastIdx < 0) return null;
  if (!isTableContextLine(lines[lastIdx])) return null;

  // 向上回溯，找到这个表格块的第一行（表头）
  let headerIdx = lastIdx;
  for (let i = lastIdx - 1; i >= 0; i--) {
    const t = lines[i].trim();
    if (t === '') break; // 空行是块边界
    if (isTableContextLine(t)) headerIdx = i;
    else break; // 遇到非表格内容，停止
  }

  const rawHeader = lines[headerIdx].trim();
  if (!isHeaderLine(rawHeader)) return null; // 块首不是表头（例如独立 `---` 分隔线）
  const columns = headerColumns(rawHeader);

  // 表头下一行是否已是完整分隔行？是则表格已成型，无需补
  const next = headerIdx + 1;
  if (next < lines.length && isCompleteSeparator(lines[next].trim(), columns)) {
    return null;
  }

  // 重建：保留表头之前的内容 + 补全的表头 + 幽灵分隔行（丢弃表头后未写完的分隔行）
  const closedHeader = rawHeader.endsWith('|') ? rawHeader : rawHeader + ' |';
  const separator = '| ' + Array(columns).fill('---').join(' | ') + ' |';
  const before = lines.slice(0, headerIdx).join('\n');
  const text = (before ? before + '\n' : '') + closedHeader + '\n' + separator;
  return { text, ghost: '\n' + separator, columns };
}

/* ---------------------- 幽灵补齐入口 ---------------------- */

/**
 * 幽灵补齐（Phantom Closing）：
 * 在解析前伪造一个“合法且闭合”的 Markdown 字符串，
 * 保证 markdown-it 输出的 AST 结构不会随流式推进发生突变。
 */
export function phantomClose(src: string): PhantomResult {
  const closed: string[] = [];
  let appended = '';
  let out = src;

  const inOpenFence = count(src, /^\s*```/gm) % 2 === 1;

  // 1) 表格幽灵补齐：表头出现（>=2 列）但分隔行未补全 → 临时补全表头 + 分隔行
  if (!inOpenFence) {
    const table = ghostCloseTable(src);
    if (table) {
      out = table.text;
      appended += table.ghost;
      closed.push(`表格幽灵补齐 ×${table.columns}列`);
    }
  }

  // 2) 代码块围栏：奇数个 ``` 说明代码块未闭合，临时补一个结束围栏
  if (inOpenFence) {
    const suffix = '\n```';
    out += suffix;
    appended += suffix;
    closed.push('```');
  }

  // 3) 行内标记：剔除代码块内容后统计
  const inline = stripFences(out);

  if (count(inline, /(?<!\\)\*\*/g) % 2 === 1) {
    out += '**';
    appended += '**';
    closed.push('**');
  }

  if (count(inline, /(?<!\\)`/g) % 2 === 1) {
    out += '`';
    appended += '`';
    closed.push('`');
  }

  const openBrackets = count(inline, /\[/g);
  const closeBrackets = count(inline, /\]/g);
  if (openBrackets > closeBrackets) {
    const suffix = '](#)';
    out += suffix;
    appended += suffix;
    closed.push('](#)');
  }

  return { text: out, closed, appended };
}
