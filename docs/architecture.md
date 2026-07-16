# 技術設計

## 1. 設計方針

- Chrome Manifest V3 を使う
- 可視範囲監視とダウンロードはユーザーの明示操作から開始する
- DOM に存在するだけでは対象にせず、メッセージ表示領域内に見えている要素へ限定する
- DOM 抽出、候補の正規化、UI、ダウンロード制御を分離する
- 認証情報を扱わず、Discord の内部 API に依存しない
- Discord の DOM は不安定な外部インターフェースとして扱う
- リモートコードを実行せず、全コードを拡張機能パッケージに含める

## 2. 推奨技術スタック

- WXT + TypeScript
- UI: MVP はフレームワークなしの TypeScript / HTML / CSS
- 単体テスト: Vitest + Happy DOM
- E2E（今後追加）: Puppeteer とローカル fixture ページ
- 静的検査: ESLint、Prettier、TypeScript strict mode

WXT は Manifest V3、TypeScript、Vite ベースのビルドとエントリーポイント生成をまとめられます。MVP の UI は小さいため、React 等は導入せず依存とバンドルサイズを抑えます。実装時にはバージョンを固定し、更新ツールによる自動マージは行いません。

## 3. コンポーネント

```text
ユーザー
  │ クリック
  ▼
Popup UI
  │ chrome.scripting.executeScript（開始時に一度）
  ▼
Visible Media Collector (unlisted) ── DOM Adapter ── Discord の現在の DOM
  │ scroll / resize / DOM change
  │ normalized candidates
  ▼
Popup UI
  │ selected candidate IDs
  ▼
Background Service Worker ── chrome.downloads ── ローカル保存先
```

### Popup UI

- 対象ページ判定
- 自動収集の開始・停止ボタン
- 候補の選択、絞り込み、件数表示
- ダウンロード要求
- 処理結果とエラーの表示

ポップアップを閉じるとコンテキストが破棄され得るため、進行中のダウンロード管理は service worker に置きます。

### Visible Media Collector

- `activeTab` と `chrome.scripting.executeScript` で、ユーザーの開始操作時だけ `scan.js` を注入
- manifest 登録の常駐 content script と恒久的 host permission は使用しない
- 初回走査後、scroll、resize、DOM変更を監視し、250 ms debounceで現在の表示領域を再走査
- チャンネル変更を検出した場合は監視を停止し、新しいチャンネルでは再度開始操作を要求
- `DOM Adapter` を呼び出して候補を抽出
- URL と表示メタデータを正規化
- メッセージ本文や認証情報は返さない

### DOM Adapter

Discord 固有のセレクターと抽出規則を閉じ込める境界です。クラス名だけに依存せず、リンク先、要素型、ARIA 属性など複数の弱いシグナルを組み合わせます。ただし、ARIA ラベルの文言は言語により変わるため、唯一の判定条件にはしません。

内部 API のレスポンス監視、webpack モジュールへのアクセス、React 内部プロパティの参照は行いません。

### Background Service Worker

- `chrome.downloads.download()` の呼び出し
- ダウンロード ID と候補 ID の対応管理
- `chrome.downloads.onChanged` による状態更新
- 同時実行数の制御
- popup 再表示時の状態返却
- service worker 再起動時の `chrome.downloads.search()` による状態再照合

service worker は停止・再起動される前提とし、検証済み候補と処理状態を `chrome.storage.session` に保持します。メディア本体や完全な URL 履歴を永続保存しません。

## 4. データモデル

```ts
type MediaKind = 'image' | 'video' | 'file';

interface MediaCandidate {
  id: string; // 正規化 URL などから生成するセッション内 ID
  sourceUrl: string; // https のみ。ログや永続領域には残さない
  kind: MediaKind;
  displayName: string;
  suggestedFilename: string;
  thumbnailUrl?: string;
  sizeHint?: number; // DOM から信頼できる場合だけ
}

type DownloadState =
  | { status: 'queued' }
  | { status: 'in_progress'; downloadId: number }
  | { status: 'complete'; downloadId: number }
  | { status: 'failed'; reason: string };
```

`sourceUrl` には期限付き署名パラメーター等が含まれる可能性があるため、秘密情報に準じて扱います。テレメトリ、例外通知、通常ログへ含めません。

## 5. 抽出戦略

候補抽出は、具体的な Discord DOM を調査した上で fixture と共に実装します。初期アルゴリズムは次の通りです。

1. チャンネルのメッセージ表示領域を特定する。特定できなければ安全側に失敗する。
2. 添付を指すアンカー、画像、動画要素を収集する。
3. `getBoundingClientRect()` と表示領域の矩形が交差し、`display: none`、`visibility: hidden` 等で非表示でない候補だけを残す。
4. アンカーのリンク先を優先し、サムネイル URL を原本 URL と誤認しないようにする。
5. `URL` API で絶対 URL にし、`https:` 以外を拒否する。
6. 許可するホストは、観測した公式 Discord/CDN ホストの allowlist と一致するものだけにする。
7. URL のフラグメントを除去したキーで重複排除する。署名クエリはダウンロードに必要なため削除しない。
8. `download` 属性、URL パス、表示テキストの順にファイル名候補を得てサニタイズする。

ホスト名や DOM セレクターを推測だけで固定しません。テスト用アカウントで実際の表示を確認し、fixture に残した上で allowlist を決定します。

## 6. ファイル名規則

初期案は次の通りです。

```text
Discord Media Exporter/<channel-label>/<original-name>
```

- `/`, `\\`, NUL、制御文字を `_` に置換
- `.` と空白だけの名前を拒否
- Windows の予約名を回避
- 拡張子は信頼できる元ファイル名を優先し、MIME 推測だけで上書きしない
- パス全体の長さを制限し、切り詰め時にも拡張子を保持
- チャンネル名が安全に取得できなければ日時ベースの汎用ディレクトリを使う
- 競合時は `uniquify` を基本とし、ユーザーの既存ファイルを上書きしない

## 7. 権限

manifest の権限は以下です。

| 権限        | 用途                                       | 方針 |
| ----------- | ------------------------------------------ | ---- |
| `activeTab` | ユーザーが起動した対象タブへの一時アクセス | 必須 |
| `scripting` | 対象タブへスキャン処理を注入               | 必須 |
| `downloads` | 保存開始と状態監視                         | 必須 |
| `storage`   | 検証済み候補と短命な処理状態               | 必須 |
| `offscreen` | メディアZIPのBlob生成                      | 必須 |

`tabs`, `cookies`, `webRequest`, `<all_urls>` および恒久的な host permission は要求しません。popup から WXT の unlisted script を動的注入し、`chrome.downloads` へ検証済み URL を直接渡します。拡張機能自身による CDN への `fetch()` は行いません。

上記は個別保存の設計です。Phase 5 のメディア ZIP では response body が必要になるため、`cdn.discordapp.com` と `media.discordapp.net` を `optional_host_permissions` として宣言し、ZIP 開始操作時だけ要求して終端状態で解放します。また Blob URL を扱う offscreen document のため `offscreen` permission を追加します。恒久的な必須 host permission や `<all_urls>` は追加しません。詳細は[メディア ZIP 出力仕様](zip-export.md)と[ADR-0003](adr/0003-generate-media-zip-locally.md)を参照してください。

## 8. メッセージング

メッセージは discriminated union とし、受信側でスキーマ検証します。

```ts
type ExtensionMessage =
  | { type: 'REGISTER_SCAN_RESULT'; scope: string; candidates: MediaCandidate[] }
  | { type: 'GET_SCAN_COLLECTION'; scope: string }
  | { type: 'CLEAR_SCAN_COLLECTION'; scope: string }
  | { type: 'START_DOWNLOADS'; candidateIds: string[] }
  | { type: 'GET_DOWNLOAD_STATUS' }
  | { type: 'START_ZIP_EXPORT'; candidateIds: string[] }
  | { type: 'CANCEL_ZIP_EXPORT' }
  | { type: 'GET_EXPORT_STATUS' };
```

- popupまたはcollectorから渡された URL やファイル名を service worker が無条件に信用しない
- 候補 ID から、自動収集中に検証・登録した候補を引き直す
- 予期しない送信元、メッセージ型、過大な配列を拒否する
- 正規化したDiscordチャンネルURLを収集スコープとし、同一スコープの候補だけを最大500件まで`chrome.storage.session`へ累積する
- ポップアップ再表示時は現在のチャンネルと一致する収集結果だけを復元する。別チャンネルへの移動時はcollectorを停止し、次の開始時に以前の候補を引き継がない

## 9. エラー処理

- 候補単位の失敗分離
- 最大同時ダウンロード数は 3
- MVP では自動リトライしない
- エラー表示から URL クエリと個人情報を除去
- service worker の処理状態は `chrome.storage.session` から復元し、既知の download ID を `chrome.downloads.search()` で再照合する

## 10. テスト戦略

### 単体テスト

- DOM fixture からの画像・動画・添付抽出
- 表示領域内・領域外・CSS 非表示の判定
- 重複排除
- URL スキーム・ホスト検証
- ファイル名サニタイズ
- メッセージスキーマ検証
- 状態遷移

### 統合テスト

- popup からの scan script 注入と戻り値の検証
- service worker と `chrome.downloads` の adapter
- popup を閉じて再度開いた場合の状態復元

### E2E（未実装）

Discord 本番を CI から操作しません。実データを匿名化して手作業で作成したローカル fixture ページへ unpacked extension を読み込み、Puppeteer で正常系・対象外ページ・DOM 変化を検証します。

実際の Discord での確認は、権利が明確なテストサーバー上で手動スモークテストとして行います。HTML の持ち出し時はメッセージ本文、ユーザー名、URL クエリ等を除去します。

## 11. 変更に強くするための境界

- `extractors/discord`: Discord DOM 依存
- `domain`: 候補、検証、ファイル名、状態遷移
- `platform/chrome`: Chrome API adapter
- `entrypoints`: popup、scan、background
- `fixtures`: 匿名化した代表 DOM

DOM 変更時は extractor と fixture を更新し、domain と UI の変更を最小化します。

## 12. Phase 5: メディア ZIP の追加境界

メディア ZIP は既存の Download Manager へ無理に統合せず、共通の候補 registry とバッチ排他を使う `ZipExportManager` として分離します。

- `domain/zip-export.ts`: ZIP内ファイル名、上限、状態遷移、エラーコード。Chrome APIとZIPライブラリに依存しない
- `platform/zip/build-media-zip.ts`: `fflate`による逐次ZIP生成、redirect・バイト数検証
- `platform/chrome/zip-export-manager.ts`: 任意権限、offscreen lifecycle、`chrome.downloads` adapter
- `entrypoints/offscreen`: Blob URL生成とbackgroundへの進捗通知
- `entrypoints/popup`: 保存形式選択、進捗、キャンセル。URL や Blob を保持しない

offscreen document は ZIP バッチの間だけ存在し、Discord の DOM や認証情報へアクセスしません。生成途中のバイト列を `chrome.storage` へ保存せず、Chrome 終了や拡張機能更新をまたぐ再開は行いません。

## 13. Phase 6: OPFSへのZIP64 streaming output

Phase 5の`build-media-zip.ts`は入力responseを逐次処理しても、出力ZIP chunkを`BlobPart[]`へ蓄積していました。Phase 6ではこの出力境界をOPFSのジョブ専用一時ファイルへ差し替え、store方式ZIP64 writerから直接書き込みます。

- `platform/zip`: store方式ZIP64 writer、OPFS temp作成・write・close・getFile・deleteを実装し、OPFS write完了まで次の入力chunk読込を進めない
- `platform/chrome`: ZIP状態、任意権限、offscreen、download lifecycleを管理する
- `entrypoints/offscreen`: fetch → ZIP64 writer → OPFS writableのpipelineとキャンセルを所有する
- `domain`: 固定件数・バイト上限を削除し、quotaとtemp write errorを状態へ追加する
- `background`: download完了・中断までtemp fileとBlob URLを追跡し、終端後に削除する
- `popup`: 推定quota、入力・出力バイト数、長時間処理の注意を表示する

Cache Storageは入力responseと完成ZIPを同時保持してピークdisk usageとI/Oを増やすため使用しません。OPFSもクォータ対象であるため、固定上限撤廃後もwrite failureを必ず処理します。詳細は[Phase 6仕様](large-zip-export.md)と[ADR-0005](adr/0005-stream-large-zip-to-opfs.md)に従います。

extractorはattachment anchorとstandaloneの`img`・`video`を単一のDOM走査で処理し、一回のscanで表示中DOMにある添付の順序を維持します。同一添付をanchorとmedia elementから複数検出した場合は、そのscanのDOM上で最初に現れた位置だけを採用します。

候補registryは`Map`の挿入順を取得順として保持します。個別保存とZIP開始時はcheckboxの選択順ではなくregistry順で対象を解決し、ZIPでは`001_`から始まる連番をentry名へ付けます。OPFSの`File.type`は空になる場合があるため、完成時に`application/zip`のBlobへ正規化してからBlob URLを作成します。

この順序保証はbest-effortです。Discordは画面外のメッセージを仮想化し、同じメッセージ内の添付が別々のscanで初めて可視になる場合があります。既存候補と同時にDOMへ存在しない新しい候補の元位置は安全に復元できないため、scanを跨ぐ順序は候補registryへの発見順とします。順序復元のためのメッセージ単位識別子、本文、投稿時刻、画面外DOM、内部APIは導入しません。

Issue #19で追加する順序精度を高める操作は[ADR-0006](adr/0006-guide-one-scroll-step-per-user-action.md)の一操作一移動境界で行います。ユーザーが任意の開始地点まで「1画面戻る」を繰り返し、popupで収集結果を明示クリアした後、「1画面進む」を一回ずつ実行します。開始地点への自動移動、自動クリア、下端までの自動巡回は行いません。

## 14. Phase 7: ガイド付き一画面収集

`scan.ts`が既存の`VisibleMediaCollector`を開始した後、Discord documentの`body`直下へShadow DOMのガイドhostを追加します。ガイドはDiscordのメッセージDOM外に置き、media extractorの対象に含めません。

- `message-viewport.ts`: message viewportとscrollable ancestorを特定
- `guided-scroll.ts`: 一回の操作で表示高の80%だけ古い方向へ移動し、ガイドUIを管理
- `visible-media-collector.ts`: scroll・DOM変更後の可視範囲scanと停止callback
- `scan.ts`: collectorとガイドのlifecycle、backgroundへの候補登録を接続

ガイドはtimerや連続loopを所有しません。button clickから同期的に一回だけ`scrollTop`を変更し、その後の収集は既存collectorのdebounceとMutationObserverに委ねます。詳細は[Phase 7仕様](guided-scroll-collection.md)と[ADR-0006](adr/0006-guide-one-scroll-step-per-user-action.md)に従います。

スポイラー解除も同じガイド内の独立したbuttonから一回だけ実行します。message viewport内の`button[aria-label]`と`[role="button"][aria-label]`から、可視かつaria-labelに`spoiler`・`スポイラー`・`ネタバレ`を含み、解除済みでない要素を最大50件clickします。class名による推測、画面外操作、自動反復は行いません。詳細は[ADR-0007](adr/0007-reveal-visible-spoilers-on-explicit-action.md)に従います。
