# 共有コンボと厳格な入力順序の実装プラン

全員で1つのコンボを積み上げ、かつ歌詞の順番通りに（リレー形式で）打たなければコンボが途切れるようにシステムを強化します。

## 提案される変更点

### [Firebase Sync] ([sync.ts](file:///c:/Users/fodat/Documents/vscode/vscode_js/%E9%80%9A%E3%81%86%E3%82%BF%E3%82%A4%E3%83%94%E3%83%B3%E3%82%B0web/src/services/sync.ts))

#### [MODIFY] [RoomState](file:///c:/Users/fodat/Documents/vscode/vscode_js/%E9%80%9A%E3%81%86%E3%82%BF%E3%82%A4%E3%83%94%E3%83%B3%E3%82%B0web/src/services/sync.ts#28-35) インターフェース
- 全員で共有するコンボ状態を追加します。
- `sharedCombo`: 現在のチーム合計コンボ。
- `maxSharedCombo`: その部屋での最大チーム合計コンボ。
- `globalLineIdx`: 現在部屋全体で入力対象となっている「絶対行番号」。
- `globalChunkIdx`: 現在入力対象となっている「チャンク番号」。

#### [NEW] 共有ステート更新関数
- `updateSharedCombo`: コンボの加算またはリセット（ミス時）を行う関数。
- `updateGlobalProgress`: 次の入力対象へとグローバルインデックスを進める関数。

---

### [UI Logic] ([TypingArea.tsx](file:///c:/Users/fodat/Documents/vscode/vscode_js/%E9%80%9A%E3%81%86%E3%82%BF%E3%82%A4%E3%83%94%E3%83%B3%E3%82%B0web/src/components/TypingArea.tsx))

#### [MODIFY] 入力・判定ロジック
- **グローバルターンの判定**: `roomState.globalLineIdx` と `globalChunkIdx` を使用して、現在部屋全体で「誰がどのチャンクを打つべきか」を特定します。
- **入力制限とコンボ**:
  - **ブロックごとの判定**: チャンク（ブロック）を1つ正常に打ち終えるごとに、`sharedCombo` を +1 加算します。
  - **順序の強制**: 自分の番でない時にキー入力を進めようとしたり、順番を飛ばして打とうとしたりした際に、`sharedCombo` を 0 にリセットします。
  - **ミスの扱い**: ユーザーの要望に基づき、ミスタイプ（キーの打ち間違い）によるコンボ切断は行いません。
- **進捗遷移**:
  - チャンク終了時: `globalChunkIdx` を進め、共有コンボを加算。
  - 行終了時: `globalLineIdx` を進め、`globalChunkIdx` を 0 に戻す。

#### [MODIFY] UI表示
- 自分のローカルコンボの代わりに `roomState.sharedCombo` を表示するように変更します。
- 現在「誰が打つべきか」が視覚的にわかるよう、グローバルにアクティブな行を強調します。

## 検証プラン

### 自動テスト
- 複数ブラウザでログインし、順番通りに打った時のみコンボが加算されることを確認。
- 順番を飛ばして（または自分の番でない時に）打った場合に `sharedCombo` が 0 に戻ることを確認。
- ミスタイプ時に全員の画面でコンボが 0 になることを確認。

### 手動検証
- 実際に2人以上でプレイし、1人がミスした時にもう1人の画面でもコンボが消えることを目視で確認。
- 前の人が打ち終わるまで自分の入力が（コンボ維持の観点で）待機状態になることを確認。
