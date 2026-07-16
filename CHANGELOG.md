# Changelog

このプロジェクトの利用者向け変更を記録します。バージョンは Semantic Versioning に従います。

## [0.9.0] - 2026-07-17

### Added

- popupを開いた明示操作後、Discordチャンネル上へ停止状態の収集launcherを表示
- ページ内ガイドの「自動収集を開始」からcollectorを開始する操作
- popupとページ内ガイドで共有するguard付きcollector start処理
- 任意設定「Discordで開始ボタンを常に表示」と、許可中のDiscordチャンネルへlauncherを自動表示する動的content script

### Changed

- 初回の可視候補登録をpopupからページ側collector controllerへ移し、popupが閉じても開始可能に変更
- 停止後はページ内ガイドを削除せず、再開可能なinactive状態へ戻す
- 常時表示をOFFにすると動的content scriptを登録解除し、Discordサイト権限を解放する

### Fixed

- 常時表示をOFFからONへ戻した際、popupから現在のDiscordチャンネルへ直接再注入し、リロードなしでlauncherを再表示

### Security

- 常時表示は明示的なON操作から`https://discord.com/*`の任意host permissionを許可した場合だけ有効化
- 常時表示を許可しない場合は、拡張機能アイコンからpopupを開いた後の`activeTab`注入を維持
- 開始ボタンを押すまで候補scan、MutationObserver、scroll・resize監視、候補登録を開始しない
- 必須host permission、静的manifest content script、`<all_urls>`、外部依存を追加しない

### Verification

- Project ownerがChrome実機で任意権限の許可・解除、launcher自動表示、popupとの状態同期、二重起動防止を確認し、問題なしと判断

## [0.8.0] - 2026-07-17

### Added

- ガイド付き収集へ、新しい投稿方向に表示高の80%だけ一回移動する「1画面進む」操作
- 任意の開始地点で収集結果を明示クリアし、下方向へ一画面ずつ収集する順序優先フロー

### Changed

- attachment anchor、standalone画像、動画を単一のDOM順で抽出し、混在形式でもメッセージ上の添付順を維持
- 同一添付を複数要素から検出した場合、DOM上で最初に現れた位置だけを採用
- checkboxの選択順にかかわらず、個別保存とZIP保存を候補registryの順序で開始
- ガイドの戻る・進む操作を、各clickにつき一回だけ選択方向へ移動する共通境界へ統一

### Security

- 順序判定を表示中DOMと既存候補registryだけに限定
- メッセージID、投稿者、本文、時刻、Discord内部API、認証情報の追加収集なし
- 下端までの連続移動、開始地点への自動移動、収集結果の自動クリアを追加しない

### Known limitations

- 添付順は一回のscanで表示中DOMにある候補を対象としたbest-effortであり、同じメッセージの添付が複数回のscanへ分かれた場合は発見順を維持する
- 互いに重ならない表示範囲を跨いだメッセージ間の順序は、候補を最初に収集した順序を維持する
- Chrome実機での上下移動、混在添付、個別・ZIP保存順の手動確認は未完了

## [0.7.0] - 2026-07-17

### Added

- popupの候補一覧へ、検証済みDiscord画像添付のサムネイルを表示
- サムネイルの遅延読み込み、非同期decode、読み込み失敗時の種類アイコンへのフォールバック

### Security

- サムネイルURLを既存allowlistで検証し、80×80のDiscord media proxy URLだけを生成
- extension pageの画像通信先をCSPで`media.discordapp.net`へ限定
- 恒久的host permission、外部依存、サムネイルの永続保存を追加しない
- 動画本体はプレビュー目的で読み込まず、動画とその他ファイルは種類アイコンを維持

### Known limitations

- Discord CDN URLの有効期限切れや取得失敗時はサムネイルを表示できない

## [0.6.1] - 2026-07-17

### Changed

- 主要な関数とメソッドへ責務、副作用、戻り値の意図を示すJSDocを追加
- backgroundのリクエスト振り分け、popupのDOM生成、offscreenのエラー分類を小さな関数へ整理
- メディア抽出処理の冗長な分岐を除去

### Security

- permission、通信先、収集範囲、保存形式、ユーザー操作境界の変更なし

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
