# 歌謡タイピング劇場 web

## セットアップ
本プロジェクトの形態素解析（kuromoji）を動作させるために、初回または `node_modules` 更新時に辞書ファイルのコピーが必要です。

```bash
npm install
# 辞書ファイルのコピー (Windows PowerShell / CMD / Git Bash 共通)
cp -r node_modules/kuromoji/dict public/kuromoji-dict
npm run dev
```

## 技術スタック
- React + TypeScript
- Vite
- kuromoji.js (形態素解析)
- vite-plugin-node-polyfills
