// ============================================================
// main.ts
// Vue 應用程式的建立與掛載入口。
// ============================================================

import { createApp } from 'vue';
import { createPinia } from 'pinia';

import App from './App.vue';
import { i18n } from './i18n';

// 全域樣式（Tailwind base/components/utilities + 自訂樣式）
import './style.css';

// 功能導覽（driver.js）基礎樣式；暗色主題覆寫於 App.vue 的全域 <style>。
import 'driver.js/dist/driver.css';

// 1. 建立 Vue 應用程式實例
const app = createApp(App);

// 2. 掛載 Pinia 狀態管理
//    必須在 app.mount() 之前呼叫，確保所有元件都能存取 store
app.use(createPinia());

// 3. 掛載 i18n（介面語言由設定選單切換，字典見 src/locales/）
app.use(i18n);

// 4. 掛載到 index.html 的 #app 容器
app.mount('#app');