# SSE 流式 Markdown 渲染 Demo

可验证的 SSE 流式 Markdown 渲染架构 Demo，核心思想：

> 数据接收 / 语法解析 / 视图渲染 三层解耦，用空间换时间，用局部更新代替全量重绘。

## 架构

```
SSE chunk → Buffer 队列 → rAF 每帧取出累积全量字符串
→ 幽灵补齐（行内标记 + 表格分隔行）→ markdown-it 生成 HTML 字符串
→ morphdom 局部 DOM Diff（保留选区/滚动）
→ 占位符 <div id="slot-..."> + ReactDOM.createPortal 注入自定义组件
```

## 本地运行

```bash
npm install
npm run dev
```

## 在线访问

<https://sunbridger.github.io/sse-markdown-render/>
