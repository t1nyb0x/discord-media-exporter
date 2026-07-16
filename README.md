# Discord Media Exporter

Discordで画面に表示した画像・動画・添付ファイルを収集し、個別またはZIPで保存するChrome拡張機能です。

現在のバージョンは`0.6.0`です。Chrome Web Storeでは公開せず、GitHub ReleaseのZIPをDeveloper modeで読み込みます。

> [!CAUTION]
> 保存するコンテンツの権利と[Discord利用規約](https://discord.com/terms)を確認し、自分が保存を許可されているメディアにだけ使用してください。

## 主な機能

- 現在表示中のDiscordメディアを収集
- 手動スクロール中に表示されたメディアを自動追加
- ページ内ガイドから、一回の操作で一画面ずつ過去の投稿へ移動
- 表示中のスポイラーを明示操作で解除
- 最大500件の候補から、必要なファイルを選択
- 個別保存または一つのZIPとして保存
- ZIP内のファイルを取得順の連番で整理
- ZIPをローカルで逐次生成し、大きなデータをメモリへ一括保持しない

ユーザー操作なしの連続スクロール、Discordの非公開API利用、ユーザートークンやCookieの取得、チャンネルの定期巡回は行いません。

## 使い方

1. DiscordのチャンネルをChromeで開く。
2. 拡張機能を開き、「自動収集を開始」を押す。
3. Discord画面の「1画面戻る」を押すか、自分でスクロールする。
4. 必要に応じて「表示中のスポイラーを解除」を押す。
5. 拡張機能を再度開き、保存する候補を選ぶ。
6. 個別保存またはZIP保存を実行する。

別チャンネルへの移動、ページの再読み込み、タブ終了、または停止操作で収集は終了します。収集結果はChromeセッション中だけ保持され、いつでもクリアできます。

## インストール

1. GitHub ReleaseからZIPとSHA-256ファイルを取得する。
2. SHA-256を照合してZIPを展開する。
3. Chromeで`chrome://extensions`を開く。
4. **Developer mode**を有効にする。
5. **Load unpacked**から、`manifest.json`がある展開済みフォルダを選ぶ。

詳しくは[インストール・更新ガイド](docs/installation.md)を参照してください。

## 開発

Node.js 24とpnpm 9を使用します。

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

配布ZIPとSHA-256の生成を含む全検証:

```bash
pnpm release:prepare
```

`main`へマージされると、GitHub Actionsが`package.json`のバージョンを使ってReleaseを作成し、ZIPとSHA-256を添付します。

## ドキュメント

- [インストール・更新](docs/installation.md)
- [プロダクト要件](docs/product-requirements.md)
- [技術設計](docs/architecture.md)
- [セキュリティとプライバシー](docs/security-and-privacy.md)
- [開発ガイド](docs/development.md)
- [コントリビューションガイド](docs/contributing.md)
- [ロードマップ](docs/roadmap.md)
- [0.6.0リリースノート](docs/release-notes-0.6.0.md)
- [ADR一覧](docs/adr/)
