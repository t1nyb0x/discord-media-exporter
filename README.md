# Discord Media Exporter

Discordで画面に表示した画像・動画・添付ファイルを収集し、個別またはZIPで保存するChrome拡張機能です。

現在の開発バージョンは`0.9.0`です。Chrome Web Storeでは公開せず、GitHub ReleaseのZIPをDeveloper modeで読み込みます。

> [!CAUTION]
> 保存するコンテンツの権利と[Discord利用規約](https://discord.com/terms)を確認し、自分が保存を許可されているメディアにだけ使用してください。

## 主な機能

- 現在表示中のDiscordメディアを収集
- 手動スクロール中に表示されたメディアを自動追加
- ページ内ガイドから、一回の操作で一画面ずつ過去または新しい投稿方向へ移動
- 表示中のスポイラーを明示操作で解除
- 最大500件の候補から、必要なファイルを選択
- 個別保存または一つのZIPとして保存
- ZIP内のファイルを取得順の連番で整理
- ZIPをローカルで逐次生成し、大きなデータをメモリへ一括保持しない

ユーザー操作なしの連続スクロール、Discordの非公開API利用、ユーザートークンやCookieの取得、チャンネルの定期巡回は行いません。

## 使い方

1. DiscordのチャンネルをChromeで開く。
2. 拡張機能を開き、Discord画面右下に停止状態の「ガイド付き収集」を表示する。
3. popupまたはDiscord画面内で「自動収集を開始」を押す。
4. Discord画面の「1画面戻る」「1画面進む」を押すか、自分でスクロールする。
5. 必要に応じて「表示中のスポイラーを解除」を押す。
6. 拡張機能を再度開き、保存する候補を選ぶ。
7. 個別保存またはZIP保存を実行する。

別チャンネルへの移動、ページの再読み込み、タブ終了、または停止操作で収集は終了します。収集結果はChromeセッション中だけ保持され、いつでもクリアできます。

### 開始ボタンを常時表示する

任意設定の「Discordで開始ボタンを常に表示」をONにしてDiscordサイト権限を許可すると、チャンネルを開いた時点でページ内の開始ボタンを表示できます。開始ボタンを押すまでメディアのscanやDOM監視は行いません。

設定をOFFにするとページ内の停止中launcherを削除し、Discordサイト権限を解放します。OFFからONへ戻した場合は、現在開いているDiscordチャンネルにもリロードなしでlauncherを再表示します。常時表示を使わなくても、popupを開く既存の方法は利用できます。

### 取得順を重視して収集する

1. 「1画面戻る」を一回ずつ押し、収集を始めたい位置へ移動する。
2. popupの「収集をクリア」で、それまでの候補を明示的に削除する。
3. 「1画面進む」を一回ずつ押し、新しく表示された候補を順番に追加する。

開始位置への自動移動、自動クリア、下端までの連続移動は行いません。添付順は表示中DOMから判断するbest-effortであり、チャンネル履歴全体やメッセージ単位の完全な順序は保証しません。

## データと権限

- 候補として保持するのは、表示中DOMから得たメディアURL、ファイル名候補、種別です。メッセージ本文、投稿者一覧、トークン、Cookie、閲覧履歴は取得しません。
- 候補はチャンネルごとに最大500件をChromeセッション中だけ保持し、「収集をクリア」またはセッション終了時に削除します。
- 開発者のサーバー、分析、広告、外部ZIPサービスへデータを送信しません。メディア取得先は検証済みのDiscord CDNだけです。
- ZIPはOPFSへ逐次生成し、完了・失敗・キャンセル後に一時ファイルと一時権限を解放します。
- 基本権限は`activeTab`、`scripting`、`downloads`、`storage`、`offscreen`です。必須host permission、`<all_urls>`、`cookies`、`webRequest`は使用しません。
- `https://discord.com/*`は開始ボタンの常時表示を明示的にONにした場合だけ要求し、OFFまで保持します。
- Discord CDN 2ホストの権限はZIP作成時だけ要求し、処理終了時に解放します。

詳しくは[セキュリティとプライバシー](docs/security-and-privacy.md)を参照してください。

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
- [変更履歴](CHANGELOG.md)
- [ガイド付き収集](docs/guided-scroll-collection.md)
- [ADR一覧](docs/adr/)
