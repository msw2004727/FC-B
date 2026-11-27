// 運動喜好截圖台（只給本機截圖，不參與正式 build）：沿用網頁推播截圖台設定，Callable 走 mock。
// 用法：node node_modules/vite/bin/vite.js --config dev-harness/vite.sport-fav.config.ts --port <空埠>
import { defineConfig, mergeConfig } from 'vite';
import base from './vite.webpush-w5.config';

export default mergeConfig(base, defineConfig({ define: { 'import.meta.env.VITE_CALLABLE_MODE': JSON.stringify('mock') } }));
