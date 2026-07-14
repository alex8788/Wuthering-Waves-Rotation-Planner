<p align="center">
  <img src="../public/Phoebe.svg" width="96" alt="logo" />
</p>

<h1 align="center">鳴潮 ローテーションプランナー</h1>

<p align="center">
  『鳴潮』のビジュアル・ローテーション作成ツール——ドラッグするだけでローテーション完成、学習コストゼロ、インストール・登録不要。
</p>

<p align="center">
  <a href="README.zh-TW.md">繁體中文</a> |
  <a href="README.zh-CN.md">简体中文</a> |
  <a href="../README.md">English</a> |
  <b>日本語</b> |
  <a href="README.ko.md">한국어</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Vue-3-42b883?logo=vue.js" alt="Vue 3" />
  <img src="https://img.shields.io/badge/TypeScript-5-3178c6?logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Vite-8-646cff?logo=vite&logoColor=white" alt="Vite" />
  <img src="https://img.shields.io/badge/Deploy-Vercel-000?logo=vercel" alt="Vercel" />
</p>

<p align="center">
  <a href="#live-demo">サイトリンク</a> ·
  <a href="#特徴">特徴</a> ·
  <a href="#スクリーンショット">スクリーンショット</a> ·
  <a href="#機能">機能</a> ·
  <a href="#キーボードショートカット">ショートカット</a> ·
  <a href="#技術スタック">技術スタック</a>
</p>

---

## Live Demo

**[wuthering-waves-rotation-planner.vercel.app](https://wuthering-waves-rotation-planner.vercel.app/)**

https://github.com/user-attachments/assets/9552c0a0-a7aa-43bf-8474-0b78d339fdd7

## 特徴
* 完全ビジュアルな操作
* インストール不要
* 多言語対応
* インタラクティブなチュートリアル
* キャラクターデータの自動更新
* ローカル保存と画像エクスポート

## スクリーンショット

<img width="2680" height="1280" alt="スクリーンショット" src="https://github.com/user-attachments/assets/35039615-6f91-4554-a435-eb67ab2a34f6" />

## 機能

### ローテーション
- **ドラッグ操作**：ブロックを自由にドラッグでき、後続のブロックは自動で整列・詰めが行われます
- **ブロック編集**：追加、削除、コピー、ペースト、カット、インラインでのテキスト編集
- **複数選択**：Ctrl+クリック、矩形選択、キャラクター軸全体の選択
- **元に戻す/やり直し**：各操作のスナップショットが履歴に保存されます

### 永続化
- **テンプレートライブラリ**：キャラクターごとによく使うスキルの組み合わせを保存
- **チームセーブ**：ローテーションをローカルに保存し、読み込み・改名・ピン留め・上書きに対応
- **複数ローテーションタブ**：同じチームに対して複数のローテーションタブを作成可能

### エクスポート
- **画像エクスポート**：1枚の画像に統合、または複数画像を ZIP にまとめて出力。多倍率 PNG および SVG 形式に対応

## キーボードショートカット

| キー | 機能 |
| --- | --- |
| `A` / `D` | 前 / 次のブロックを選択 |
| `W` / `S` | 前 / 次のキャラクター軸を選択 |
| `Space` | ブロックを追加 |
| `Enter` | 選択中のブロックを編集 |
| `Delete` / `Backspace` | 選択中のブロックを削除 |
| `Ctrl+A` | すべてのブロックを選択 |
| `Ctrl+C` / `Ctrl+X` / `Ctrl+V` / `Ctrl+D` | コピー / カット / ペースト / 右へ複製 |
| `Ctrl+Z` | 元に戻す |
| `Ctrl+Shift+Z` / `Ctrl+Y` | やり直し |
| `Escape` | すべての選択を解除 |
| `Tab` | サイドバーの開閉 |

## 対応言語

ページ右上の歯車アイコンから言語を切り替えられます。

* 繁體中文
* 简体中文
* English (デフォルト)
* 日本語
* 한국어

## 技術スタック

- **フレームワーク**：Vue 3 + TypeScript + Vite + Pinia + TailwindCSS
- **ドラッグ&ドロップ**：VueDraggablePlus
- **エクスポート**：html-to-image + JSZip
- **多言語**：vue-i18n
- **チュートリアル**：driver.js
- **永続化**：LocalStorage

## API 利用

キャラクター・属性データの提供元：[encore.moe](https://encore.moe/?lang=en)

## ローカル開発

```bash
npm install      # 依存関係をインストール
npm run dev      # 開発サーバーを起動
npm run build    # 型チェック + ビルド
```

## License

本プロジェクトは [MIT License](../LICENSE) の下で公開されています。

## その他

1. 一部の翻訳に誤りがある場合があります。フィードバックを歓迎します。
2. VS Code 内蔵ブラウザで画像をエクスポートする際、保存ダイアログが2回表示されます。1回目は壊れたファイル、2回目が正常なファイルです。
