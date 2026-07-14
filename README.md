# Discord Media Exporter

ブラウザで現在表示している Discord チャンネルから、画面内の画像・動画・添付ファイルを一覧化し、ユーザーが選択したものをローカルへ保存する Chrome 拡張機能の企画リポジトリです。

> [!CAUTION]
> Discord の現行利用規約は、書面による同意のないサービスのスクレイピングや、通常のユーザーアカウントの自動化を禁止しています。本プロジェクトはクローラーや履歴エクスポーターではなく、ユーザー操作による「表示中メディアの保存支援」に限定します。ただし、拡張機能による一括抽出が規約上のスクレイピングに当たらないという公式な適用除外は確認できていません。利用前に[Discord 利用規約](https://discord.com/terms)を確認してください。

## 現在の状態

- フェーズ: Discovery / 設計
- 実装: 未着手
- 対象: Google Chrome、Manifest V3
- 最初の対象画面: `https://discord.com/channels/*`
- 目的: 表示中メディアの保存支援
- 方針: ユーザー操作を起点に、メッセージ表示領域内で現在見えているメディアだけを扱う
- 配布: Chrome Web Store は使わず、信頼できる利用者が unpacked extension として手動で読み込む

## MVP の概要

1. Discord のチャンネルをブラウザで開く
2. 拡張機能のアイコンを押す
3. 現在のメッセージ表示領域内に見えているメディアの一覧を確認する
4. 保存対象を選択する
5. Chrome のダウンロード機能でローカルへ保存する

MVP では、画面外や過去ログの収集、自動スクロール、Discord の非公開 API の呼び出し、ユーザートークンや Cookie の取得、バックグラウンド巡回は行いません。

## ドキュメント

- [プロダクト要件](docs/product-requirements.md)
- [技術設計](docs/architecture.md)
- [セキュリティとプライバシー](docs/security-and-privacy.md)
- [開発ガイド](docs/development.md)
- [インストール・更新ガイド](docs/installation.md)
- [ロードマップ](docs/roadmap.md)
- [ADR-0001: 表示中メディアの保存支援](docs/adr/0001-user-initiated-dom-export.md)

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
