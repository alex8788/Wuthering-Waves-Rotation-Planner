<p align="center">
  <img src="../public/Phoebe.svg" width="96" alt="logo" />
</p>

<h1 align="center">鳴潮排軸編輯器</h1>

<p align="center">
  鳴潮視覺化排軸工具——拖曳即排軸,零上手成本,免安裝免登入。
</p>

<p align="center">
  <b>繁體中文</b> |
  <a href="README.zh-CN.md">简体中文</a> |
  <a href="../README.md">English</a> |
  <a href="README.ja.md">日本語</a> |
  <a href="README.ko.md">한국어</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Vue-3-42b883?logo=vue.js" alt="Vue 3" />
  <img src="https://img.shields.io/badge/TypeScript-5-3178c6?logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Vite-8-646cff?logo=vite&logoColor=white" alt="Vite" />
  <img src="https://img.shields.io/badge/Deploy-Vercel-000?logo=vercel" alt="Vercel" />
</p>

<p align="center">
  <a href="#live-demo">網站連結</a> ·
  <a href="#特色">特色</a> ·
  <a href="#成品展示">成品展示</a> ·
  <a href="#功能">功能</a> ·
  <a href="#快捷鍵一覽">快捷鍵</a> ·
  <a href="#技術棧">技術棧</a>
</p>

---

## Live Demo

**[wuthering-waves-rotation-planner.vercel.app](https://wuthering-waves-rotation-planner.vercel.app/)**

https://github.com/user-attachments/assets/9552c0a0-a7aa-43bf-8474-0b78d339fdd7

## 特色
* 純視覺化操作
* 免安裝
* 多語言支援
* 使用教學導覽
* 自動更新資料
* 本地保存與匯出

## 成品展示

<img width="2680" height="1280" alt="愛長千" src="https://github.com/user-attachments/assets/35039615-6f91-4554-a435-eb67ab2a34f6" />

## 功能

### 排軸
- **拖曳式操作**：區塊可自由拖曳,且後方區塊會自動對齊、補位
- **區塊編輯**：新增、刪除、複製、貼上、剪下、行內編輯文字
- **多重選取**：Ctrl+點選、滑鼠框選、整條角色軸選取
- **復原/重做**：每一步操作的快照會存入歷史紀錄中

### 資料持久化
- **模板庫**：儲存角色常用的基礎招式組合
- **隊伍存檔**：本地保存角色排軸,支援載入、重新命名、置頂、覆寫等操作
- **多開輸出軸**：可為同一支隊伍建立多條輸出軸分頁

### 輸出
- **圖片匯出**：合併成單張圖片或將多張圖片打包為 ZIP 檔案；支援多倍率 PNG 以及 SVG 格式

## 快捷鍵一覽

| 按鍵 | 功能 |
| --- | --- |
| `A` / `D` | 選取前 / 後一個區塊 |
| `W` / `S` | 選取上 / 下一個角色軸 |
| `Space` | 新增區塊 |
| `Enter` | 編輯選取的區塊 |
| `Delete` / `Backspace` | 刪除選取的區塊 |
| `Ctrl+A` | 選取全部區塊 |
| `Ctrl+C` / `Ctrl+X` / `Ctrl+V` / `Ctrl+D` | 複製 / 剪下 / 貼上 / 向右複製 |
| `Ctrl+Z` | 復原 |
| `Ctrl+Shift+Z` / `Ctrl+Y` | 重做 |
| `Escape` | 清除所有選取 |
| `Tab` | 展開/收合側邊欄 |

## 支援的語言

可於頁面右上角的齒輪圖示切換語言。

* 繁體中文
* 简体中文
* English (預設)
* 日本語
* 한국어

## 技術棧

- **框架**：Vue 3 + TypeScript + Vite + Pinia + TailwindCSS
- **拖曳**：VueDraggablePlus
- **匯出**：html-to-image + JSZip
- **多語系**：vue-i18n
- **導覽**：driver.js
- **資料持久化**：LocalStorage

## API 使用

角色與屬性資料來源：[encore.moe](https://encore.moe/?lang=en)

## 本地開發

```bash
npm install      # 安裝依賴
npm run dev      # 啟動開發伺服器
npm run build    # 型別檢查 + 產出
```

## License

本專案採用 [MIT License](../LICENSE) 授權。

## 其他說明

1. 部分翻譯可能有誤，歡迎回報
2. 使用 VS Code 內建瀏覽器匯出圖片時會彈出兩次儲存對話框，第一次會產生壞檔，第二次為正常檔案
