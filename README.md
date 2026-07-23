<p align="center">
  <img src="public/Phoebe.svg" width="96" alt="logo" />
</p>

<h1 align="center">Wuthering Waves Rotation Planner</h1>

<p align="center">
  A visual rotation planner for Wuthering Waves — drag to build your rotation, zero learning curve, no install or sign-up.
</p>

<p align="center">
  <a href="docs/README.zh-TW.md">繁體中文</a> |
  <a href="docs/README.zh-CN.md">简体中文</a> |
  <b>English</b> |
  <a href="docs/README.ja.md">日本語</a> |
  <a href="docs/README.ko.md">한국어</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Vue-3-42b883?logo=vue.js" alt="Vue 3" />
  <img src="https://img.shields.io/badge/TypeScript-5-3178c6?logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Vite-8-646cff?logo=vite&logoColor=white" alt="Vite" />
  <img src="https://img.shields.io/badge/Deploy-Vercel-000?logo=vercel" alt="Vercel" />
</p>

<p align="center">
  <a href="#live-demo">Live Demo</a> ·
  <a href="#highlights">Highlights</a> ·
  <a href="#showcase">Showcase</a> ·
  <a href="#features">Features</a> ·
  <a href="#keyboard-shortcuts">Shortcuts</a> ·
  <a href="#tech-stack">Tech Stack</a>
</p>

---

## Live Demo

**[wuthering-waves-rotation-planner.vercel.app](https://wuthering-waves-rotation-planner.vercel.app/)**

https://github.com/user-attachments/assets/9552c0a0-a7aa-43bf-8474-0b78d339fdd7

## Highlights
* Fully visual, drag-based editing
* Fast hotkey input
* No installation required
* Multi-language support
* Built-in interactive tutorial
* Auto-updated character data
* Local saves and image export

## Showcase

<img width="2680" height="1280" alt="showcase" src="https://github.com/user-attachments/assets/35039615-6f91-4554-a435-eb67ab2a34f6" />

## Features

### Rotation
- **Drag & drop**: blocks move freely, and following blocks automatically align and fill the gap
- **Block editing**: add, delete, copy, paste, cut, and edit text inline
- **Multi-select**: Ctrl+click, marquee selection, or select an entire character track
- **Hotkey input mode**: map custom keys to blocks and insert them rapidly at the end of a character track like a rhythm game — supports tap/hold and mouse buttons
- **Undo/redo**: a snapshot of every action is stored in the history

### Persistence
- **Template library**: save frequently used skill combos for each character
- **Team saves**: store rotations locally, with load, rename, pin, and overwrite
- **Multiple rotation tabs**: create several rotation tabs for the same team

### Export
- **Image export**: merge into a single image or bundle multiple images into a ZIP; supports multi-scale PNG and SVG

## Keyboard Shortcuts

| Key | Action |
| --- | --- |
| `A` / `D` (or `←` / `→`) | Select the previous / next block |
| `W` / `S` (or `↑` / `↓`) | Select the previous / next character track |
| `Space` | Add a block |
| `Enter` | Edit the selected block |
| `Delete` / `Backspace` | Delete selected blocks |
| `Ctrl+A` | Select all blocks |
| `Ctrl+C` / `Ctrl+X` / `Ctrl+V` / `Ctrl+D` | Copy / cut / paste / duplicate to the right |
| `Ctrl+Z` | Undo |
| `Ctrl+Shift+Z` / `Ctrl+Y` | Redo |
| `Ctrl+S` / `Ctrl+Shift+S` | Save changes / Save as |
| `Escape` | Clear all selection |
| `Tab` | Toggle the sidebar |
| `Shift`+Wheel | Scroll the rotation horizontally |

### Hotkey Input Mode

| Key | Action |
| --- | --- |
| `F` | Enter hotkey input mode |
| `1` / `2` / `3` (or wheel) | Switch character track |
| `Delete` / `Backspace` | Delete the block at the very end of the timeline |
| `Escape` | Exit hotkey input mode |

## Supported Languages

Switch languages from the gear icon in the top-right corner.

* 繁體中文
* 简体中文
* English (default)
* 日本語
* 한국어

## Tech Stack

- **Framework**: Vue 3 + TypeScript + Vite + Pinia + TailwindCSS
- **Drag & drop**: VueDraggablePlus
- **Export**: html-to-image + JSZip
- **i18n**: vue-i18n
- **Onboarding tour**: driver.js
- **Persistence**: LocalStorage

## API Usage

Character and attribute data source: [encore.moe](https://encore.moe/?lang=en)

## Local Development

```bash
npm install      # install dependencies
npm run dev      # start the dev server
npm run build    # type-check + build
```

## License

This project is licensed under the [MIT License](LICENSE).

## Notes

1. Some translations may contain errors; feedback is welcome.
2. When exporting images from the VS Code built-in browser, the save dialog appears twice — the first produces a broken file, and the second is the correct one.
