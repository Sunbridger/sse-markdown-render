import MarkdownIt from 'markdown-it';

/**
 * 流式引擎：markdown-it（轻量，纯字符串 -> HTML）。
 * html: true 让 <div id="slot-..."> 占位符原样透传，供 Portal 注入。
 */
export const md = new MarkdownIt({
  html: true,
  linkify: true,
  breaks: false,
  typographer: false,
});
