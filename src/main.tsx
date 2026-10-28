import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

// 注意：刻意不用 <StrictMode>，避免开发模式下 effect / render 被双调用，
// 从而让「组件渲染次数」等可验证指标保持精确。
createRoot(document.getElementById('root')!).render(<App />);
