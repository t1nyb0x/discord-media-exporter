# 開発ガイド

## 1. 前提

このリポジトリは現在、設計段階です。以下は MVP 実装を開始する際の標準手順案であり、まだ実行可能なアプリケーションはありません。

実装開始前に [README の実装開始条件](../README.md#実装開始の条件)を満たしてください。

## 2. 開発環境案

- 最新の Chrome Stable と、リリース対象として定める最小 Chrome バージョン
- Node.js の Active LTS（実装開始時に `.nvmrc` と `package.json#engines` で固定）
- pnpm（`packageManager` でバージョン固定）
- WXT + TypeScript

バージョン番号は実装開始日に公式サポート状況を確認して決定します。「latest」のまま CI やリリースを動かしません。

## 3. 予定するディレクトリ構成

```text
.
├── entrypoints/
│   ├── background.ts
│   ├── content.ts
│   └── popup/
│       ├── index.html
│       ├── main.ts
│       └── style.css
├── src/
│   ├── domain/
│   ├── extractors/discord/
│   ├── platform/chrome/
│   └── shared/
├── tests/
│   ├── fixtures/
│   ├── unit/
│   └── e2e/
├── public/icons/
├── docs/
├── wxt.config.ts
└── package.json
```

## 4. 実装順序

1. 最小 manifest と空の popup/content/background をビルドする
2. URL・ファイル名・メッセージの純粋な検証関数をテスト駆動で作る
3. 匿名化した DOM fixture と extractor を作る
4. popup に候補一覧と選択操作を作る
5. `chrome.downloads` adapter と状態遷移を作る
6. ローカル fixture で E2E を通す
7. テストサーバーで手動スモークテストする
8. 権限・ログ・unpacked 配布物をセキュリティレビューする

## 5. ローカル確認の想定手順

実装後のコマンド名は次に統一します。

```bash
pnpm install --frozen-lockfile
pnpm dev
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm build
```

unpacked extension の読み込み:

1. `chrome://extensions` を開く
2. Developer mode を有効にする
3. Load unpacked を選ぶ
4. WXT が生成した Chrome MV3 用ディレクトリを指定する
5. 権限警告が設計書と一致することを確認する

利用者にも同じ手順で、ビルド済みフォルダだけを指定してもらいます。ソースツリー全体や秘密情報を含むディレクトリは配布しません。更新時は配布元の SHA-256 を確認してファイルを差し替え、`chrome://extensions` で **Reload** します。

Windows と macOS の一般ユーザーへ、自前サーバー上の `.crx` を通常のリンクから直接インストールさせる方式は使えません。自己ホスト CRX は Linux または enterprise policy で管理された環境向けです。本プロジェクトでは自動更新を提供せず、バージョン通知と差し替えを手動運用にします。

## 6. fixture の作り方

実在チャンネルの HTML をそのままコミットしません。

1. 権利が明確なテストサーバーで代表ケースを表示する。
2. 必要な DOM 構造だけを最小 HTML として手で再構成する。
3. ユーザー名、本文、チャンネル名、server ID、channel ID、message ID を架空値にする。
4. URL は `https://cdn.example.test/...` 等へ置き換え、署名クエリを残さない。
5. avatar、絵文字、アクセシビリティ文言にも個人情報がないことを確認する。
6. 正常系、欠損属性、重複、悪意あるファイル名、未対応 DOM の fixture を分ける。

DOM セレクターを更新する変更には、必ず再現 fixture とテストを含めます。

## 7. 手動スモークテスト

規約上のゲートを通過した後、専用テストサーバーで次を確認します。

- 画像、動画、その他添付が正しく分類される
- 埋め込みリンクのプレビューを添付と誤認しない
- スポイラー付き添付、長い名前、日本語名を扱える
- 同一添付のサムネイルとリンクを重複表示しない
- 表示されていない過去メッセージへ勝手に移動しない
- 保存前に全対象を確認できる
- popup を閉じても開始済みダウンロードが壊れない
- 403/404/ネットワーク切断時に他の処理が継続する

テストでダウンロードしたファイルは、権利と保持方針に従って処分します。

## 8. Definition of Done

変更は次を満たした時に完了とします。

- 要件 ID または不具合への対応関係が説明されている
- lint、typecheck、単体、E2E が成功している
- 新しい DOM 分岐には匿名化 fixture がある
- 権限の追加・変更がない、または理由と UI 説明が更新されている
- ログに URL、メッセージ、個人情報が含まれない
- キーボードだけで主要操作ができる
- Chrome で手動確認されている
- 関連ドキュメントと変更履歴が更新されている

## 9. リリース前チェック

- バージョンを SemVer で更新
- clean install から全検査を実行
- 生成 manifest と権限をレビュー
- source map、fixture、開発設定が unpacked 配布物に混入していないことを確認
- リモートコードや未承認通信がないことを確認
- README のデータ取り扱い説明と実装を照合
- Discord 利用規約を再確認
- 配布 ZIP の SHA-256 を記録
- インストール、更新、無効化、削除の手順を同梱
- テスト用と本番用の設定・アイコンを取り違えていないことを確認
- ロールバック可能な直前リリース成果物を保持
