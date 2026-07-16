# Changelog

このプロジェクトの利用者向け変更を記録します。バージョンは Semantic Versioning に従います。

## [0.6.0] - 2026-07-16

### Added

- 自動収集開始後にDiscord画面内へ表示するガイド付き収集パネル
- ユーザーのclickごとに古い投稿方向へ表示高の80%だけ移動する「1画面戻る」操作
- ガイドからの停止、500件到達時の移動無効化、上端・scroll container不明時の安全な停止表示
- scroll container検出、一操作一移動、停止、チャンネル変更を扱う自動テスト
- Phase 7仕様とADR-0006
- ZIP内ファイルを候補の取得順に`001_`から始まる連番で格納
- 明示操作時だけ、表示範囲内のスポイラーを最大50件解除するガイドbutton
- スポイラー解除の可視範囲・aria-label・件数上限テストとADR-0007

### Security

- timer・再帰・連続loopによる無人の自動スクロールを不使用
- Discord内部API、Gateway、ユーザートークン、Cookie、追加permissionを不使用
- ガイドUIをShadow DOMへ隔離し、外部scriptと`innerHTML`を不使用
- スポイラーは画面外・disabled・不明要素を操作せず、自動反復と設定永続化を不使用

### Fixed

- OPFSから返す完成archiveのMIME typeが空で、Chrome環境によって`.txt`として扱われる問題
- ZIP対象を選択した順序で解決していたため、候補の取得順とentry順が一致しない問題

### Known limitations

- DiscordのDOM・scroll container変更により移動できなくなる可能性がある
- ガイド付き収集がDiscord規約上許可されるという公式な適用除外は確認できていない
- 実Discordでの移動方向、描画待ち、UI重なり、停止条件の手動確認が必要

## [0.5.1] - 2026-07-16

### Added

- 4 GiB直前・超過のentry sizeとoffsetを実データなしで検証するZIP64テスト
- 65,535件・65,536件のZIP64 end record境界テスト
- 101件をfetchからOPFS、`File`、ZIP展開まで通すadapter integration test
- OPFS孤児一時ファイルのcleanup失敗件数返却と次回起動相当の再試行テスト
- 保存先容量不足`FILE_NO_SPACE`の専用エラー表示と状態復元テスト
- `navigator.storage.estimate()`による推定空き容量表示テスト

### Changed

- ZIP64 writerが既存prefixを持つsinkの初期offsetを扱えるようにし、4 GiB超offsetをsynthetic検証可能に変更

## [0.5.0] - 2026-07-16

### Added

- store方式のZIP64 streaming writer
- ZIP出力chunkをOrigin Private File System（OPFS）の一時ファイルへ逐次書き込む処理
- 入力バイト数とZIP出力バイト数の進捗表示
- 開始前のOPFS推定空き容量表示
- quota不足、OPFS write失敗、孤児一時ファイルcleanupの自動テスト

### Changed

- ZIP固有の100件、1ファイル50 MiB、入力合計100 MiBの固定上限を撤廃
- 候補registryの既存上限500件まで、選択した全候補をZIP対象として受け付ける
- archive全体をJavaScript heapへ蓄積せず、CDN responseからOPFSへbackpressure付きで逐次処理
- CDN responseを最大3件まで先行取得し、ZIPへの格納順序を維持したまま通信待ちを重ねる
- OPFS writeを最大1 MiBの有界バッファで集約し、進捗保存を500ms単位に間引く

### Security

- 入力responseをCache Storage、IndexedDB、`chrome.storage`へ複製しない
- `unlimitedStorage`や新しいhost permissionを追加しない
- 完了・失敗・キャンセル・download終了後と次回offscreen起動時に一時ファイルを削除

### Known limitations

- 保存可能容量はOPFSクォータ、物理ディスク空き容量、CDN URLの有効性に依存する
- 1 GiB、4 GiB直前・超過、保存先disk不足、OS標準展開機能のChrome Stable実機検証は未完了
- Chrome終了や拡張機能reload/updateをまたぐZIP生成の再開には非対応

## [0.4.1] - 2026-07-16

### Fixed

- 自動収集が継続中でも、時間を置いてpopupを再表示するとボタンがOFF表示になる問題
- collector状態確認をChrome runtime messagingで確実に返すため、認識済み要求へPromiseで応答

### Documentation

- Phase 5の`0.3.0`実機確認完了と、`0.4.0`自動収集課題を分離
- Phase 6のOPFS・ZIP64による全選択候補ZIP仕様とADR-0005を追加

## [0.4.0] - 2026-07-16

### Added

- ユーザーが一度開始した後、同じチャンネルの手動スクロール中に表示されたメディアを自動収集
- 自動収集の停止、チャンネル移動時の自動停止、最大500件のセッション保持と明示クリア

### Security

- 自動収集をユーザーが開始したタブと同じチャンネルの可視範囲だけに限定
- 自動スクロール、恒久的host permission、Discord内部API、Cookie、ユーザートークンを不使用

### Known limitations

- DiscordのDOM変更により、自動収集が停止または検出できなくなる可能性がある
- Chrome実機での長時間スクロール、チャンネル移動、停止条件の手動確認がリリースゲートとして残っている

## [0.3.0] - 2026-07-15

### Added

- 選択した表示中メディアを一つのZIPへまとめる出力
- ZIPの取得件数、処理ファイル、バイト数、完了・失敗・キャンセル表示
- 100件、1ファイル50 MiB、合計100 MiBのZIP出力上限
- `main`更新時に配布ZIPとSHA-256をGitHub Releaseへ添付するworkflow

### Security

- ZIP利用時だけDiscord CDN 2ホストへの任意権限を要求し、終了時に解放
- redirect後のURL、実読込バイト数、ZIP内ファイル名を再検証
- Cookie、Authorization header、外部ZIPサービスを不使用
- `fflate`を0.8.3へ固定し、MITライセンスを配布物へ同梱

### Known limitations

- ZIP生成はChrome終了や拡張機能更新をまたいで再開できない
- 100 MiB上限のChrome実機メモリ計測と実Discordでの手動確認がリリースゲートとして残っている

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
