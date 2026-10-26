import type { FeatureManifest } from '@/core/feature-types';
// 首頁是落地頁：靜態引入，HomePage 隨入口一起下載，不再等入口 JS 執行完才發現這個 chunk（T-041 A2）。
// 其他頁維持 lazy。HomePage 的靜態相依不得含 Firebase SDK（有測試守門），否則入口會多帶約 160 KB gz。
import HomePage from './pages/HomePage';

export const manifest: FeatureManifest = {
  id: 'home',
  status: 'enabled',
  routes: [
    {
      path: '/',
      titleKey: 'home.title',
      load: () => Promise.resolve({ default: HomePage }),
    },
  ],
  nav: [{ path: '/', labelKey: 'nav.home', icon: 'home', order: 2 }],
};
