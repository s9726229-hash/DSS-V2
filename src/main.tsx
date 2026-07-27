/* 只載入 latin 子集：中文交由系統字體，不需要希臘／斯拉夫／越南文字集。 */
import '@fontsource/ibm-plex-sans/latin-400.css';
import '@fontsource/ibm-plex-sans/latin-500.css';
import '@fontsource/ibm-plex-sans/latin-600.css';
import '@fontsource/ibm-plex-mono/latin-400.css';
import '@fontsource/ibm-plex-mono/latin-500.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AppShell } from './app/AppShell';
import './app/theme.css';

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('找不到 #root 掛載節點');
}

createRoot(rootElement).render(
  <StrictMode>
    <AppShell />
  </StrictMode>,
);
