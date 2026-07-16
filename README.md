# Discord Media Exporter

ブラウザで現在表示している Discord チャンネルから、画面内の画像・動画・添付ファイルを一覧化し、ユーザーが選択したものをローカルへ保存する Chrome 拡張機能です。

> [!CAUTION]
> Discord の現行利用規約は、書面による同意のないサービスのスクレイピングや、通常のユーザーアカウントの自動化を禁止しています。本プロジェクトはクローラーや履歴エクスポーターではなく、ユーザー操作による「表示中メディアの保存支援」に限定します。ただし、拡張機能による一括抽出が規約上のスクレイピングに当たらないという公式な適用除外は確認できていません。利用前に[Discord 利用規約](https://discord.com/terms)を確認してください。

## 現在の状態

- フェーズ: Phase 7 / Guided one-page collection
- 実装: `0.6.0`でユーザー操作ごとに一画面だけ古い投稿へ遡るガイド付き収集を追加。無人の連続スクロールは行わない
- 対象: Google Chrome、Manifest V3
- 最初の対象画面: `https://discord.com/channels/*`
- 目的: 表示中メディアの保存支援
- 方針: ユーザー操作を起点に、メッセージ表示領域内で現在見えているメディアだけを扱う
- 配布: Chrome Web Store は使わず、信頼できる利用者が unpacked extension として手動で読み込む

実装済み:

- `activeTab` を使った明示的な可視範囲スキャン
- 一度開始すると、同じチャンネルを手動スクロールする間に表示された候補を自動追加する可視範囲監視
- Discord画面内の明示操作ごとに古い投稿へ一画面だけ遡るガイド付き収集
- 明示操作時だけ現在表示中のスポイラーを解除するガイドbutton
- 最大500件のセッション内候補収集と明示的な停止・クリア
- Discord 添付 URL の allowlist 検証と重複排除
- 画像、動画、その他添付の一覧・絞り込み・選択
- 安全なファイル名による最大 3 件ずつのダウンロード
- popup を閉じた場合に備えたセッション内の進捗保持
- URL、ファイル名、可視範囲、DOM fixture、ダウンロード状態遷移の単体テスト
- ファイル単位のダウンロード進捗・失敗理由の表示
- service worker 再起動後のダウンロード状態再照合
- 選択項目のメディアZIP出力、進捗、キャンセル
- ZIP固有の固定件数・バイト上限を設けない、最大500候補の全選択ZIP
- store方式ZIP64 writerとOPFS一時ファイルへのbackpressure付き逐次出力
- 最大3件の先行取得、1 MiBのOPFS書き込み集約、500ms単位の進捗更新
- OPFS推定空き容量、入力・ZIP出力バイト数、quota・一時書き込み失敗の表示
- ZIP内ファイルを取得順の`001_`連番で格納し、完成Blobを`application/zip`として保存
- ZIP終了時の任意CDN権限解放

2026-07-15 に確認済み:

- unpacked extension の読み込み
- 実際の Discord チャンネルにおける表示中メディアの検出
- 候補の選択とダウンロード
- `0.2.0` 限定配布候補の回帰確認

2026-07-16 に確認済み:

- `0.3.0`メディアZIP出力の実機動作
- `0.6.0`ガイド付き一画面収集の実機動作

追加検証が必要:

- スポイラー付き添付などの画面バリエーション
- ネットワーク切断や期限切れ URL などの異常系
- Chrome/Discord の更新後の実機回帰
- Phase 6の101件・500件、1 GiB、4 GiB境界、quota・disk不足のChrome Stable実測
- Windows/macOS/Linuxの標準展開機能と代表的ZIP64対応ツールによる互換性確認

Phase 6の実装方針:

- 選択した候補を候補registryの上限500件まで一つのZIPにまとめる
- 既存の個別保存と表示範囲の制約は維持
- CDN responseを一件ずつ読み、ZIP64出力をOPFS一時ファイルへ逐次書き込む
- 固定容量上限の代わりにOPFSクォータと実書き込み結果を扱う
- ZIP 利用時だけ Discord CDN 2 ホストへの任意アクセスを要求

要件と検証計画は[Phase 6 全選択候補のディスクストリーミングZIP](docs/large-zip-export.md)、設計判断は[ADR-0005](docs/adr/0005-stream-large-zip-to-opfs.md)を参照してください。

## MVP の概要

1. Discord のチャンネルをブラウザで開く
2. 拡張機能のアイコンを押す
3. 「自動収集を開始」を押す
4. Discord画面右下の「1画面戻る」を押すか、自分でスクロールする
5. 画面に現れた候補は同じチャンネルの一覧へ自動追加される
6. 拡張機能を再度開き、必要なら自動収集を停止する
7. 累積された一覧から保存対象を選択する
8. 個別保存またはZIP保存でローカルへ保存する

開始後の監視では、その時点で画面内に見えている項目だけを扱います。ユーザー操作なしの連続自動スクロール、Discord の非公開 API の呼び出し、ユーザートークンや Cookie の取得、定期巡回は行いません。別チャンネルへの移動、再読み込み、タブ終了、または停止操作で監視を終了します。候補URLは同じチャンネルの収集結果としてChromeセッション中だけ保持し、UIから明示的にクリアできます。

## 開発とローカルインストール

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

`chrome://extensions` で Developer mode を有効にし、**Load unpacked** から `.output/chrome-mv3` を選択します。実際の Discord で確認するまでは、権利が明確なテスト用チャンネルだけで使用してください。

## ドキュメント

- [プロダクト要件](docs/product-requirements.md)
- [技術設計](docs/architecture.md)
- [セキュリティとプライバシー](docs/security-and-privacy.md)
- [開発ガイド](docs/development.md)
- [インストール・更新ガイド](docs/installation.md)
- [0.2.0 リリースノート](docs/release-notes-0.2.0.md)
- [0.3.0 リリースノート](docs/release-notes-0.3.0.md)
- [0.4.0 リリースノート](docs/release-notes-0.4.0.md)
- [0.4.1 リリースノート](docs/release-notes-0.4.1.md)
- [0.5.0 リリースノート](docs/release-notes-0.5.0.md)
- [0.5.1 リリースノート](docs/release-notes-0.5.1.md)
- [0.6.0 リリースノート](docs/release-notes-0.6.0.md)
- [限定配布テストチェックリスト](docs/testing/limited-beta-checklist.md)
- [Phase 5 メディアZIP手動テスト](docs/testing/zip-export-checklist.md)
- [Phase 5 自動検証記録](docs/reviews/phase5-automated-verification.md)
- [0.4.0 自動収集機能の検証記録](docs/reviews/0.4.0-automated-verification.md)
- [0.4.1 リリース検証記録](docs/reviews/0.4.1-release-verification.md)
- [Phase 6 自動検証記録](docs/reviews/phase6-automated-verification.md)
- [0.5.1 自動境界検証記録](docs/reviews/0.5.1-automated-verification.md)
- [Phase 7 自動検証記録](docs/reviews/phase7-automated-verification.md)
- [Phase 6 全選択候補のディスクストリーミングZIP](docs/large-zip-export.md)
- [Phase 7 ガイド付き一画面収集](docs/guided-scroll-collection.md)
- [保守・更新方針](docs/maintenance.md)
- [ロードマップ](docs/roadmap.md)
- [メディア ZIP 出力仕様](docs/zip-export.md)
- [ADR-0001: 表示中メディアの保存支援](docs/adr/0001-user-initiated-dom-export.md)
- [ADR-0002: 少人数への unpacked 配布を継続する](docs/adr/0002-continue-limited-unpacked-distribution.md)
- [ADR-0003: メディア ZIP を拡張機能内で生成する](docs/adr/0003-generate-media-zip-locally.md)
- [ADR-0004: ユーザー開始後の表示中メディア自動収集](docs/adr/0004-observe-visible-media-after-user-start.md)
- [ADR-0005: 大容量ZIPをOPFSへ直接ストリーミングする](docs/adr/0005-stream-large-zip-to-opfs.md)
- [ADR-0006: ユーザー操作ごとに一画面だけ遡る](docs/adr/0006-guide-one-scroll-step-per-user-action.md)
- [ADR-0007: 明示操作時だけ表示中のスポイラーを解除する](docs/adr/0007-reveal-visible-spoilers-on-explicit-action.md)

## リリース

`main`へ反映されるとGitHub Actionsが全検査を実行し、`package.json`のバージョンをタグにしたGitHub Releaseを作成します。Releaseにはunpacked配布用ZIPとSHA-256ファイルを添付します。公開済みバージョンは上書きしないため、`main`へマージする変更では事前にバージョンを更新してください。

## 実装開始の条件

次をすべて満たしてから、第三者へ渡すビルドを作成します。

- 用途が「現在表示されているメディアの、ユーザー選択による保存支援」から広がっていない
- Discord の利用規約を確認し、この限定用途で利用する判断と責任主体が明確になっている
- 利用者へ権限、データの扱い、規約・権利上の注意を説明できる
- テスト用 Discord サーバーと、再配布権を含め権利関係が明確なテストメディアを用意している
- MVP の対象を「現在のメッセージ表示領域内」に限定することを関係者が合意している

## 配布方法

利用者へビルド済みの拡張機能フォルダを渡し、`chrome://extensions` の Developer mode から **Load unpacked** を選んで読み込んでもらいます。更新時は新しいフォルダへ差し替えて **Reload** する手動運用です。詳しくは[インストール・更新ガイド](docs/installation.md)を参照してください。

一般ユーザー向けに `.crx` を自前サーバーから直接インストールする方式は採用しません。Chrome の公式ドキュメントでは、Chrome Web Store 外での自己ホスト配布は原則として管理対象環境向けで、Windows と macOS では enterprise policy が必要です。

## 参考資料

- [Chrome Extensions: Manifest V3](https://developer.chrome.com/docs/extensions/develop/migrate/what-is-mv3)
- [Chrome Extensions: `chrome.downloads`](https://developer.chrome.com/docs/extensions/reference/api/downloads)
- [Chrome Extensions: 権限の宣言](https://developer.chrome.com/docs/extensions/develop/concepts/declare-permissions)
- [Chrome Extensions: Distribute your extension](https://developer.chrome.com/docs/extensions/how-to/distribute)
- [Discord Terms of Service](https://discord.com/terms)
- [Discord: Automated User Accounts (Self-Bots)](https://support.discord.com/hc/en-us/articles/115002192352-Automated-User-Accounts-Self-Bots)
