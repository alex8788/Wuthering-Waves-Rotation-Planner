import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath, URL } from 'node:url';

// https://vite.dev/config/
export default defineConfig({
  // 掛載 Vue 核心插件，讓 Vite 能夠解析 .vue 單檔案元件
  plugins: [vue()],

  // 模組路徑解析設定
  resolve: {
    alias: {
      // 設定 '@' 別名指向 src/ 目錄，徹底解耦深層相對路徑
      // 使用範例：import BlockChip from '@/components/ui/BlockChip.vue'
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },

  // 本地開發伺服器環境設定
  server: {
    port: 5173, // 鎖定預設連接埠，避免多個專案衝突時亂跳號
    open: false, // 執行 npm run dev 時自動開啟瀏覽器視窗，提升開發效率
  },
});