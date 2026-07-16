# セキュリティとプライバシー

## 1. 基本原則

この拡張機能は、ユーザーの私的な会話や期限付きメディア URL に接触し得ます。したがって「端末内で動くから安全」とはみなさず、取得しない・送らない・残さないことを既定にします。

- 明示操作: 可視範囲監視の開始と保存はユーザー操作時のみ。監視中は表示変化に応じて自動走査する
- データ最小化: 保存に必要な URL とファイル名候補だけを短時間保持
- 最小権限: 全サイト、Cookie、履歴、ネットワーク監視の権限を要求しない
- ローカル処理: 開発者のサーバー、分析基盤、広告 SDK を使わない
- 透明性: 権限、扱うデータ、保持期間、制約を UI と同梱文書で説明する
- 安全側の失敗: 判定できない URL や DOM は無視し、権限を広げて回避しない

## 2. 扱うデータ

| データ                | 用途              | 保持                           | 外部送信                       |
| --------------------- | ----------------- | ------------------------------ | ------------------------------ |
| メディア URL          | 候補収集・保存    | セッション中または明示削除まで | Discord/CDN への通常の取得のみ |
| 表示ファイル名        | 保存名の候補      | セッション中または明示削除まで | しない                         |
| メディア種別          | 一覧・絞り込み    | セッション中または明示削除まで | しない                         |
| ダウンロード ID・状態 | 進捗表示          | セッション中                   | しない                         |
| UI 設定               | 利便性            | ローカルに永続                 | しない                         |
| ZIP 生成中のバイト列  | メディア ZIP 作成 | 処理中のメモリ                 | しない                         |

メッセージ本文、認証トークン、Cookie、パスワード、ユーザー一覧、閲覧履歴は取得対象外です。サムネイル表示が必要な場合も、既に DOM に存在する URL を使い、プロキシサーバーへ転送しません。

候補は正規化したチャンネルURLをスコープとして最大500件まで`chrome.storage.session`に保持します。ポップアップを閉じても同じブラウザセッション中は復元されますが、別チャンネルの候補とは混在させません。「収集をクリア」で明示削除でき、Chromeセッション終了時にも破棄されます。

自動収集はユーザーが開始したタブ内だけで動作します。popupが閉じた後もscroll、resize、DOM変更を監視しますが、対象はその時点でメッセージ表示領域と交差する添付だけです。別チャンネルへの移動、再読み込み、タブ終了、または「自動収集を停止」で監視を終了します。

Phase 7のガイド付き収集は、ユーザーがページ内の「1画面戻る」を押した場合だけ、一回だけ古い投稿方向へ移動します。timer・再帰・連続loopによる無人scrollは行いません。ガイドはShadow DOMへ隔離し、外部script、`innerHTML`、追加permissionを使用しません。

スポイラー解除は「表示中のスポイラーを解除」を押した場合だけ実行します。現在のメッセージ表示領域内で、aria-labelによりスポイラーと確認できる可視操作要素を最大50件clickします。URLの直接迂回、画面外解除、自動反復、設定永続化は行いません。

## 3. 脅威モデル

### 悪意あるページからの偽メッセージ

ページ側は動的に注入する scan script と同じ DOM に影響を与えられます。候補 URL、ファイル名、メッセージは信用せず、service worker 側で URL、候補 ID、ファイル名を再検証します。外部からの拡張メッセージ受信は有効化しません。

### 任意 URL のダウンロードに悪用される

- `https:` のみ許可
- Discord で観測・承認したホストを完全一致または安全なサブドメイン判定で allowlist 化
- `endsWith('discord.com')` のような境界のない判定は禁止
- ユーザーが開始した自動収集中に生成した ID に対応する URL だけを保存
- 一回の最大件数を制限

### パストラバーサルと危険なファイル名

パス区切り、`..`、制御文字、OS 予約名、極端に長い名前を除去します。元の名前を HTML として描画せず、DOM へ入れる場合は `textContent` を使います。

### 機密 URL の漏えい

Discord の CDN URL には期限や署名情報が含まれる可能性があります。完全な URL を console、例外通知、分析、診断情報へ出しません。表示する場合は origin と伏せたパスだけにします。

### DOM 変更による誤取得

セレクターが一致しなくなった時に範囲をページ全体へ広げません。メッセージ領域を特定できない場合はスキャンを失敗させます。fixture テストに加え、リリース前にテストサーバーで保存対象を目視確認します。

### 依存関係・サプライチェーン

- runtime dependency を最小化
- lockfile をコミット
- CI のインストールは lockfile 固定モード
- リモートスクリプト、動的 `eval`、CDN 配信コードを禁止
- 依存更新は差分、配布物、権限変更をレビューしてから取り込む

### メディア ZIP によるリソース枯渇と権限拡大

Phase 5 の ZIP 出力では、従来の個別保存と異なり、拡張機能が Discord CDN の response body を読みます。

- CDN 2 ホストを任意ホスト権限として宣言し、ZIP 開始時に要求して完了・失敗・キャンセル後に解放する
- `<all_urls>`、Cookie、`webRequest`、Authorization header を使わない
- redirect 後の URL も scheme、hostname、attachment path で再検証する
- 一件ずつ取得し、件数、一件のバイト数、合計バイト数を実測値で制限する
- 上限超過、取得失敗、キャンセル時は不完全な ZIP を保存しない
- ZIP writer を静的に同梱し、リモートコードや外部 ZIP サービスを使わない

詳細は[メディア ZIP 出力仕様](zip-export.md)に従います。

## 4. ログ方針

通常ログに記録してよいもの:

- 匿名のイベント種別
- 候補件数
- URL を含まないエラーコード
- 拡張機能バージョン

記録してはいけないもの:

- 完全な URL とクエリ
- メッセージ本文、チャンネル名、サーバー名、ユーザー名
- Cookie、Authorization header、localStorage の内容
- ローカル保存パス

本番ビルドではデバッグログを既定で無効にします。ユーザーが診断情報をコピーする場合は、内容を表示して確認できるようにします。

## 5. 規約・法的なゲート

2025 年 9 月 29 日発効の Discord 利用規約は、書面による同意のないスクレイピングを禁止しています。また Discord は、通常ユーザーアカウントを OAuth2/bot API 外で自動化する self-bot を禁止し、アカウント停止につながる可能性があると説明しています。

そのため、次は技術的に可能でも実装しません。

- ユーザートークンを使った API 呼び出し
- DOM を自動スクロールして履歴を網羅する処理
- 定期巡回、新着監視、複数チャンネルの無人収集
- レート制限、権限、期限付き URL の回避

ただし、MVP の「手動で、現在表示中の項目を保存する」という限定だけで、規約上のスクレイピングに当たらないことが保証されるわけではありません。第三者へ提供する前に利用規約を再確認し、用途と責任主体を明確にします。不確実性を許容できない場合は Discord へ確認するか、ブラウザ標準の個別保存を使います。

ユーザー開始後の可視範囲監視も自動処理を含むため、規約上の不確実性は手動の一回走査より高くなります。自動スクロールやAPI利用を行わないことだけで適用除外になるとは判断しません。

利用者は、対象コンテンツの著作権、肖像、プライバシー、所属サーバーのルールを守る必要があります。拡張機能 UI では初回利用時と一括保存前に短い注意を表示します。

## 6. 非公開・手動配布の要件

Chrome Web Store へは公開しません。ビルド済みフォルダを信頼できる利用者へ限定して渡し、Developer mode の **Load unpacked** で読み込んでもらいます。Store 審査がないことを安全性の根拠にはせず、単一目的と最小権限を維持します。

配布前チェック:

- README または同梱文書で、収集・利用・共有・保持・削除方法を実態どおりに説明する
- 権限ごとの必要性を説明する
- データ販売、広告利用、第三者提供をしない
- 配布 ZIP の SHA-256 をリリースノートへ記載する
- 利用者へ、信頼できる入手元、Developer mode のリスク、手動更新・削除方法を説明する
- 機能追加時に「表示中メディアの保存支援」から逸脱していないかレビューする

## 7. セキュリティレビュー・チェックリスト

- [ ] manifest に `<all_urls>`, `cookies`, `webRequest`, `history` がない
- [ ] `eval`, `new Function`, リモートコードがない
- [ ] URL は scheme と hostname の両方を検証している
- [ ] ファイル名サニタイズに単体テストがある
- [ ] HTML への動的挿入に `innerHTML` を使っていない
- [ ] 完全な URL や個人情報をログへ出していない
- [ ] 一括保存前に対象件数と権利上の注意を表示する
- [ ] 匿名化 fixture に実在人物・実メッセージ・署名 URL が残っていない
- [ ] 依存監査と配布物レビューが完了している
- [ ] Discord 規約をリリース時点で再確認した
- [ ] 配布物のハッシュと手動更新手順を記録した

Phase 5 の追加項目:

- [ ] 必須 host permission がなく、任意 host permission が Discord CDN 2 ホストだけである
- [ ] ZIP の全終端状態で任意 host permission を解放する
- [ ] `offscreen` permission の用途が Blob に限定され、処理後に document と Blob URL を破棄する
- [ ] ZIP 取得で `credentials: 'omit'` を使い、redirect 後 URL を再検証している
- [ ] 件数・単体容量・合計容量の境界値と実データ量超過をテストしている
- [ ] 失敗・キャンセル・context 消失時に不完全な ZIP を保存しない
- [ ] ZIP ライブラリのライセンス、lockfile、脆弱性、bundle をレビューした

Phase 6 の追加項目:

- [ ] 入力responseをCache Storage、IndexedDB、`chrome.storage`へ複製していない
- [ ] ZIP64出力をOPFSへ逐次writeし、archive全体をJavaScript heapへ保持していない
- [ ] quota・disk不足、write/close失敗、キャンセルで不完全ZIPを保存しない
- [ ] 完了・失敗・キャンセル・download中断・次回起動でOPFS一時ファイルをcleanupする
- [ ] OPFS内部名、完全なURL、ローカル保存パスを状態・ログへ残していない
- [ ] `unlimitedStorage`を追加していない。追加する場合は別ADRと権限説明を承認した
- [ ] ZIP64 writerのlicense、lockfile、脆弱性、bundle、4 GiB境界互換性をレビューした

Phase 7 の追加項目:

- [ ] ガイドはpopupで収集開始後だけ表示される
- [ ] 一回のclickに対してscroll処理が一回だけ実行される
- [ ] timer・再帰・連続loopによる無人scroll経路がない
- [ ] 上端・container不明・500件到達時に追加移動しない
- [ ] 停止・チャンネル変更・reloadでガイドを削除する
- [ ] Shadow DOM内でも外部script、`innerHTML`、個人情報表示がない
- [ ] Discord規約上の適用除外を保証しないことを利用者へ説明する
- [ ] スポイラー解除は明示button、可視範囲、aria-label、最大50件に限定する
- [ ] 画面外・disabled・通常buttonをclickせず、自動反復しない

## 8. 参考資料

- [Discord Terms of Service](https://discord.com/terms)
- [Discord: Automated User Accounts (Self-Bots)](https://support.discord.com/hc/en-us/articles/115002192352-Automated-User-Accounts-Self-Bots)
- [Chrome Extensions: Declare permissions](https://developer.chrome.com/docs/extensions/develop/concepts/declare-permissions)
- [Chrome Extensions: Storage and cookies](https://developer.chrome.com/docs/extensions/develop/concepts/storage-and-cookies)
- [Chrome Extensions: Permissions list](https://developer.chrome.com/docs/extensions/reference/permissions-list)
- [Chrome Developers: File System Access API / OPFS](https://developer.chrome.com/docs/capabilities/web-apis/file-system-access)
- [Chrome Extensions: Distribute your extension](https://developer.chrome.com/docs/extensions/how-to/distribute)
