// 賽事第 4 步預覽截圖。只畫 step4b 元件與假資料，不連 Firestore、不呼叫 Functions。
// ?screen= 與 ?theme=light|dark。截圖腳本等 window.__CPS_READY。
// 進階沒有預覽旗標，畫完後由這裡點正式的「進階」再開就緒旗標。

import { render } from 'preact';
import '../styles/legacy-vars.css';
import '../styles/tokens.css';
import '../styles/base.css';
import './cp-step4b-harness.css';
import { setLocale } from '@/i18n/i18n';
import { renderStep4bScreen } from '@/features/competitions/step4b';
import { STEP4B_SCREENS, type Step4bScreen } from '@/features/competitions/testing/step4b-fixtures';

const params = new URLSearchParams(location.search);
const screenName = params.get('screen') || 'link-rep';
const theme = params.get('theme') === 'dark' ? 'dark' : 'light';
document.documentElement.setAttribute('data-theme', theme);

function isScreen(value: string): value is Step4bScreen {
  return (STEP4B_SCREENS as readonly string[]).includes(value);
}

function buttonsNamed(name: string): HTMLButtonElement[] {
  return [...document.querySelectorAll('button')].filter((node) => (node.textContent ?? '').replace(/\s+/g, ' ').trim() === name);
}

function clickButton(name: string, index = 0): void {
  const node = buttonsNamed(name)[index];
  if (!node) throw new Error(`找不到按鈕：${name}`);
  node.click();
}

async function until(label: string, ready: () => boolean): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < 4000) {
    if (ready()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`畫面未出現：${label}`);
}

function hasText(text: string): boolean {
  return (document.body.textContent ?? '').includes(text);
}

const OPEN: Partial<Record<Step4bScreen, () => Promise<void>>> = {
  'rules-advanced': async () => {
    clickButton('進階');
    await until('進階', () => hasText('吃牌越少分數越高'));
  },
};

void start();

async function start(): Promise<void> {
  await setLocale('zh-TW');
  const win = window as unknown as { __CPS_COPY: unknown[]; __CPS_READY?: boolean; __CPS_ERROR?: string };
  win.__CPS_COPY = [];
  const root = document.getElementById('app');
  if (!root) return;
  if (!isScreen(screenName)) {
    win.__CPS_ERROR = `沒有這個 screen：${screenName}`;
    return;
  }
  try {
    render(renderStep4bScreen(screenName), root);
    await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
    await OPEN[screenName]?.();
    win.__CPS_READY = true;
  } catch (err) {
    win.__CPS_ERROR = err instanceof Error ? err.message : String(err);
  }
}
