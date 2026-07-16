# Discord Media Exporter AI Development Guide

## プロジェクト概要

Discord Media Exporterは、ユーザーがDiscord Webで表示した画像・動画・添付ファイルを選択し、個別またはZIPでローカル保存するChrome拡張機能です。

クローラー、履歴エクスポーター、self-botではありません。Discordの非公開APIや認証情報を使わず、ユーザーが表示した範囲と明示操作を機能境界とします。

## 判断の優先順位

実装に迷った場合は、次の順序で判断してください。

1. ユーザーの明示操作とプライバシー境界を守れるか
2. 「表示中メディアの保存支援」という目的に収まるか
3. シンプルか
4. 保守・テストしやすいか
5. 将来拡張しやすいか

将来使う可能性だけを理由に、抽象化、依存関係、権限、保存データを増やしてはいけません。

## 現在のスコープ

含むもの:

- `discord.com/channels/*`で表示中のメディア候補を収集する
- ユーザー開始後の手動スクロールで、新しく表示された候補を追加する
- 一回の明示操作につき、一画面だけ古い投稿方向へ移動する
- 明示操作時だけ、表示中のスポイラーを解除する
- 最大500件の候補を選択し、個別またはZIPで保存する
- ZIPをOPFSへ逐次出力し、ZIP64へ対応する

含まないもの:

- Discordの内部・非公開API、Gateway、ユーザートークン、Cookieの利用
- 無人の連続スクロール、履歴全体の網羅、定期巡回、新着監視
- 画面外メディアの収集
- メッセージ本文、投稿者一覧、リアクションのエクスポート
- 期限切れURL、権限、DRMの回避
- 外部サーバーへのアップロード、分析、広告
- Discord以外のサービス対応

スコープを広げる変更は、実装前にプロダクト要件、セキュリティ文書、ADRを更新してください。

## リポジトリ構成と責務

```text
entrypoints/
├── popup/       ユーザー操作、候補選択、進捗表示
├── scan.ts      Discordページ内collectorとガイドのcomposition
├── background.ts
└── offscreen/   ZIP完成Blobのダウンロード連携

src/
├── domain/              Chrome APIやDOMに依存しないモデルとルール
├── extractors/discord/  Discord DOMの検出、可視性、ガイド付き操作
├── platform/chrome/     chrome.* API adapterと処理管理
├── platform/zip/        ZIP64 writer、OPFS、逐次ZIP生成
└── shared/              context間のメッセージ型と検証

tests/
├── fixtures/    匿名化したDiscord DOM
└── unit/        ドメイン、DOM、Chrome adapter、ZIPのテスト
```

責務境界を維持してください。

- `domain`はDOM、Chrome API、WXT、ZIPライブラリへ依存しない
- Discord固有のDOM判定は`extractors/discord`へ置く
- `chrome.*`の呼び出しはentrypointまたは`platform/chrome`へ置く
- ZIP形式とOPFS処理は`platform/zip`へ置く
- entrypointは処理を組み立て、複雑なビジネスルールを持たない
- context間メッセージはdiscriminated unionとして検証する

## セキュリティ境界

次の条件は変更しないでください。変更が必要な場合は、明示的な依頼とADRが必要です。

- 収集開始と保存はユーザー操作を起点にする
- メッセージ表示領域を特定できない場合は安全側に失敗する
- DOMに存在しても画面外の候補は収集しない
- timer、再帰、連続loopによる無人スクロールを行わない
- Discordトークン、Cookie、Local Storageの認証情報を読まない
- `<all_urls>`、`cookies`、`webRequest`、恒久的host permissionを追加しない
- ZIP用CDN権限は任意権限とし、処理の終端で解放する
- Discord CDN以外へメディアURLを送信しない
- 完全な署名付きURL、個人情報、保存先パスをログへ出さない
- 失敗・キャンセル時に不完全なZIPを保存しない
- ZIP全体や大きなメディアをJavaScript heapへ一括保持しない

動的な文字列は`innerHTML`ではなく`textContent`等の安全なAPIで表示します。

## コーディング方針

TypeScriptのstrict設定を前提とします。

- `unknown`と型ガードを優先する
- 公開関数は明確な入出力を持つ
- `any`、`as any`、根拠のないnon-null assertionを避ける
- 小さな関数と明確な責務を優先する
- 大容量処理ではStream、AsyncIterable、backpressureを検討する
- エラーは原因別に扱い、利用者向け文言から機密情報を除く
- 既存の標準APIと依存関係で実現できる場合は、新しい依存を追加しない

Discordのclass名は不安定です。セレクターは意味のある属性、リンク先、要素型、可視性を組み合わせ、特定できない場合に対象範囲を広げないでください。

## テストとfixture

振る舞いを変更した場合は、対応するテストを追加または更新します。

特に次を確認してください。

- 表示領域内外とCSS非表示
- URL allowlist、redirect、重複排除
- ファイル名の安全性と取得順
- collectorの開始、停止、チャンネル変更
- 一操作一scroll、上端、500件上限
- スポイラーの可視性、ラベル、解除済み状態
- ZIP64境界、CRC、OPFS cleanup、容量不足、キャンセル
- Chrome service worker再起動後の状態復元

実在するDiscord HTMLをそのままコミットしてはいけません。fixtureは必要な構造だけを再構成し、ユーザー名、本文、server/channel/message ID、署名付きURLを匿名化します。

通常の自動テストからDiscord本番へ接続しません。Discord DOMやChrome実装に依存する変更は、自動テストに加えて権利が明確なテスト用チャンネルで手動確認します。

## ドキュメントとADR

利用方法、権限、データ保持、DOM抽出、ZIP形式、リリース方法を変更した場合は、関連ドキュメントも更新してください。

次の場合はADRを作成または更新します。

- 複数の実装案から重要な方式を選ぶ
- セキュリティ・プライバシー境界を変える
- Chrome権限、保存方式、通信先を変える
- 後から覆すコストが高い

詳細な開発ルールは[コントリビューションガイド](docs/contributing.md)を参照してください。

## Gitとリリース

ユーザーから明示的に依頼されない限り、commit、push、branch作成、Pull Request作成、rebase、resetを行わないでください。

変更を公開する場合:

- 一つの目的ごとにコミットする
- PRへ目的、原因、変更、影響、検証結果を記載する
- `main`へマージするリリース変更では、`package.json`を未公開のSemVerへ更新する
- 公開済みバージョンやReleaseを上書きしない

## 完了条件

変更内容に応じて、実在するスクリプトから必要な確認を実行します。

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm format:check
pnpm build
```

リリース候補では次を実行します。

```bash
pnpm release:prepare
```

実行していない確認を成功したものとして報告してはいけません。失敗や未確認項目は、そのまま明記してください。
