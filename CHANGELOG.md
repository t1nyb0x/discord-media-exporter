# Changelog

このプロジェクトの利用者向け変更を記録します。バージョンは Semantic Versioning に従います。

## [0.2.0] - 2026-07-15

### Added

- 表示中の Discord 画像、動画、その他添付の検出・選択・保存
- ファイル単位の待機、保存中、完了、失敗表示
- 最大 3 件のダウンロードキュー
- service worker 再起動後のダウンロード状態再照合
- 限定配布 ZIP のmanifest監査とSHA-256生成

### Security

- Discord添付URLをHTTPS、許可ホスト、`/attachments/`パスで検証
- 候補IDとURL、ファイル名をbackground側で再検証
- `activeTab`, `scripting`, `downloads`, `storage`以外の権限を不使用
- 恒久的host permission、Cookie、ユーザートークン、内部APIを不使用

### Known limitations

- Chrome Web Storeでの配布と自動更新には非対応
- DiscordのDOM変更時には検出できなくなる可能性がある
- スポイラー付き添付など一部の画面バリエーションは未検証
- 依存関係監査の運用は未確定
