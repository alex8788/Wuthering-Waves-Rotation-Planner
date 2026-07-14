<p align="center">
  <img src="../public/Phoebe.svg" width="96" alt="logo" />
</p>

<h1 align="center">鸣潮排轴编辑器</h1>

<p align="center">
  鸣潮可视化排轴工具——拖拽即排轴,零上手成本,免安装免登录。
</p>

<p align="center">
  <a href="README.zh-TW.md">繁體中文</a> |
  <b>简体中文</b> |
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
  <a href="#live-demo">网站链接</a> ·
  <a href="#特色">特色</a> ·
  <a href="#成品展示">成品展示</a> ·
  <a href="#功能">功能</a> ·
  <a href="#快捷键一览">快捷键</a> ·
  <a href="#技术栈">技术栈</a>
</p>

---

## Live Demo

**[wuthering-waves-rotation-planner.vercel.app](https://wuthering-waves-rotation-planner.vercel.app/)**

https://github.com/user-attachments/assets/9552c0a0-a7aa-43bf-8474-0b78d339fdd7

## 特色
* 纯可视化操作
* 免安装
* 多语言支持
* 使用教学引导
* 自动更新数据
* 本地保存与导出

## 成品展示

<img width="2680" height="1280" alt="成品截图" src="https://github.com/user-attachments/assets/35039615-6f91-4554-a435-eb67ab2a34f6" />

## 功能

### 排轴
- **拖拽式操作**：区块可自由拖拽,且后方区块会自动对齐、补位
- **区块编辑**：新增、删除、复制、粘贴、剪切、行内编辑文字
- **多重选取**：Ctrl+点选、鼠标框选、整条角色轴选取
- **撤销/重做**：每一步操作的快照会存入历史记录中

### 数据持久化
- **模板库**：储存角色常用的基础招式组合
- **队伍存档**：本地保存角色排轴,支持载入、重命名、置顶、覆写等操作
- **多开输出轴**：可为同一支队伍建立多条输出轴标签页

### 输出
- **图片导出**：合并成单张图片或将多张图片打包为 ZIP 文件；支持多倍率 PNG 以及 SVG 格式

## 快捷键一览

| 按键 | 功能 |
| --- | --- |
| `A` / `D` | 选取前 / 后一个区块 |
| `W` / `S` | 选取上 / 下一个角色轴 |
| `Space` | 新增区块 |
| `Enter` | 编辑选取的区块 |
| `Delete` / `Backspace` | 删除选取的区块 |
| `Ctrl+A` | 选取全部区块 |
| `Ctrl+C` / `Ctrl+X` / `Ctrl+V` / `Ctrl+D` | 复制 / 剪切 / 粘贴 / 向右复制 |
| `Ctrl+Z` | 撤销 |
| `Ctrl+Shift+Z` / `Ctrl+Y` | 重做 |
| `Escape` | 清除所有选取 |
| `Tab` | 展开/收起侧边栏 |

## 支持的语言

可于页面右上角的齿轮图标切换语言。

* 繁體中文
* 简体中文
* English (默认)
* 日本語
* 한국어

## 技术栈

- **框架**：Vue 3 + TypeScript + Vite + Pinia + TailwindCSS
- **拖拽**：VueDraggablePlus
- **导出**：html-to-image + JSZip
- **多语言**：vue-i18n
- **引导**：driver.js
- **数据持久化**：LocalStorage

## API 使用

角色与属性数据来源：[encore.moe](https://encore.moe/?lang=en)

## 本地开发

```bash
npm install      # 安装依赖
npm run dev      # 启动开发服务器
npm run build    # 类型检查 + 产出
```

## License

本项目采用 [MIT License](../LICENSE) 授权。

## 其他说明

1. 部分翻译可能有误,欢迎回报
2. 使用 VS Code 内建浏览器导出图片时会弹出两次保存对话框,第一次会产生坏档,第二次为正常文件
