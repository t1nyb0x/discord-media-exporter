# Phase 6: 全選択候補のディスクストリーミング ZIP

## 1. 目的

Phase 5 のメディア ZIP は、選択件数 100 件、1ファイル 50 MiB、入力合計 100 MiB の固定上限を持ちます。Phase 6 ではこのアプリケーション固定上限を廃止し、候補 registry に登録され、ユーザーが選択した全候補を一つの ZIP として処理できるようにします。

この文書でいう「すべて」は、開始時にユーザーが選択した検証済み候補の全件です。現在の候補収集上限 500 件は別の安全境界として維持します。ディスク空き容量、Chrome が拡張機能 origin に割り当てるクォータ、取得元 URL の有効性まで無制限になることは意味しません。

実装状況: `0.5.1` automated boundary verification complete / Chrome Stable large-volume verification and LZIP-07 known-size estimate follow-up pending

## 2. 前提の整理

個別メディアを Cache Storage へ保存してから最後に ZIP 化しても、サイズ制約そのものは消えません。

- Cache Storage と Origin Private File System（OPFS）は、どちらも拡張機能 origin のストレージクォータ対象です。
- Cache Storage に入力全件を置く方式は、ZIP 完成直前に「入力キャッシュ合計 + 一時 ZIP」の領域を必要とします。
- Cache から全件を再読込して ZIP 化するため、CDN response から一時 ZIP へ直接流す方式よりディスク I/O が増えます。
- 最後に `chrome.downloads.download()` へ渡せる URL が必要です。入力をキャッシュしただけでは完成 ZIP の生成・保存経路は解決しません。
- `navigator.storage.estimate()` の `usage` と `quota` は推定値であり、実際の空きディスク容量や書き込み成功を保証しません。書き込み時の `QuotaExceededError` と OS の容量不足を必ず処理する必要があります。

そのため Phase 6 は入力メディアを個別キャッシュせず、取得した chunk を ZIP writer へ渡し、生成された ZIP chunk を OPFS の一時ファイルへ直接書き込みます。

## 3. スコープ

### 含むもの

- ZIP 固有の 100 件上限を廃止し、選択した全候補を処理する
- 1ファイル 50 MiB、入力合計 100 MiB の固定上限を廃止する
- ZIP64 対応の streaming writer
- OPFS 上のジョブ単位一時 ZIP への逐次書き込み
- `navigator.storage.estimate()` を使った開始前の参考容量表示
- `Content-Length` が得られる項目について、入力合計と必要一時容量の概算を表示
- クォータ不足、ディスク不足、書き込み失敗、取得失敗、キャンセル時の原子的な失敗
- 成功・失敗・キャンセル・次回起動時の一時ファイル削除
- 入力件数、完了件数、入力バイト数、ZIP出力バイト数、現在のファイル名の進捗表示

### 含まないもの

- 物理ディスクまたはブラウザクォータを超える「無制限」保存
- 候補収集上限 500 件の撤廃
- Cache Storage へのメディア response の恒久・一時保存
- `unlimitedStorage` permission の追加
- Chrome 終了、拡張機能 reload/update をまたぐ ZIP 生成の再開
- 失敗項目を除外した部分 ZIP の成功扱い
- 分割 ZIP、暗号化 ZIP、パスワード ZIP
- CDN response の圧縮し直しによる容量削減保証

## 4. ユーザーフロー

1. ユーザーは収集済み候補から ZIP 対象を選択する。「全選択」の場合は候補 registry の全件を対象にできる。
2. popup は対象件数、取得サイズの既知合計・不明件数、現在の推定利用量・クォータ、処理が長時間になる可能性を表示する。
3. ユーザーが開始すると、従来どおり Discord CDN の任意 host permission を要求する。
4. offscreen document はジョブ専用の OPFS 一時ファイルを作成する。
5. 各メディアを一件ずつ取得し、検証済み chunk を ZIP64 writer へ渡す。writer の出力 chunk は OPFS へ順番に書き込む。
6. 全 entry と central directory の書き込み・close が成功した後、OPFS の `File` から Blob URL を作成する。
7. background は Blob URL を `chrome.downloads.download()` へ渡す。
8. download の完了または中断後に Blob URL、OPFS 一時ファイル、offscreen document、任意 host permission を解放する。

`Content-Length` が欠損している場合や保存容量を正確に予測できない場合は、「必要容量は確定できない」と明示します。固定上限へフォールバックせず、実書き込みの失敗を安全に処理します。

## 5. 機能要件

| ID      | 要件                                                                                                       | 優先度 |
| ------- | ---------------------------------------------------------------------------------------------------------- | ------ |
| LZIP-01 | ZIP 固有の件数上限を設けず、開始時に選択された検証済み候補を全件処理する                                   | Must   |
| LZIP-02 | 固定の単体・合計バイト上限を設けず、CDN response を一件ずつ stream として処理する                          | Must   |
| LZIP-03 | 4 GiB を超える entry・archive を扱える ZIP64 streaming writer を使用する                                   | Must   |
| LZIP-04 | ZIP出力 chunk をOPFS一時ファイルへ逐次書き込みし、archive全体をJavaScript heapへ保持しない                 | Must   |
| LZIP-05 | 入力responseをCache Storage、IndexedDB、`chrome.storage`へ複製しない                                       | Must   |
| LZIP-06 | writer出力とOPFS書き込みの間にbackpressureを設け、未書き込みchunk数・バイト数を有界に保つ                  | Must   |
| LZIP-07 | 開始前に`navigator.storage.estimate()`のusage・quotaと、既知の`Content-Length`合計を参考情報として表示する | Should |
| LZIP-08 | `QuotaExceededError`、write/close失敗、OS容量不足を一般化したエラーとして扱い、不完全なZIPを保存しない     | Must   |
| LZIP-09 | 全entry成功後だけ保存を開始し、一件でも取得・検証・書き込みに失敗した場合はジョブ全体を失敗とする          | Must   |
| LZIP-10 | キャンセル時にfetch、reader、ZIP writer、OPFS writableを停止し、一時ファイルを削除する                     | Must   |
| LZIP-11 | 通常終了だけでなく、次回offscreen起動時にも孤児一時ファイルを列挙・削除する                                | Must   |
| LZIP-12 | 進捗に入力件数・バイト数とZIP出力バイト数を含め、完全なURLやローカルパスを含めない                         | Must   |
| LZIP-13 | 既存のredirect、host、path、filename、Cookieなし、権限解放の検証境界を維持する                             | Must   |
| LZIP-14 | 選択候補をregistryへの取得順で処理し、ZIP内ファイル名へ連番を付ける                                        | Must   |
| LZIP-15 | 完成したOPFS `File`を`application/zip`のBlobとしてdownloadへ渡す                                           | Must   |

## 6. リソース方針

Phase 6 はアプリケーション固定の件数・バイト上限を廃止しますが、次の実行時境界を維持します。

| 資源                       | 方針                                                                                                  |
| -------------------------- | ----------------------------------------------------------------------------------------------------- |
| 候補件数                   | 既存のチャンネル単位500件上限を維持する                                                               |
| JavaScript heap            | 現在のfetch chunk、最大2件の先行response、1 MiB write buffer、writer内部状態。archive全体を保持しない |
| OPFS                       | 完成予定ZIP一つと小さなメタデータだけ。入力responseの複製を置かない                                   |
| origin quota               | `estimate()`で参考表示し、全write/closeの失敗を処理する                                               |
| 物理ディスク               | 正確な事前把握は保証されない。書き込み・downloadの容量不足を失敗として処理する                        |
| ZIP形式                    | ZIP64を必須とし、4 GiB境界、entry offset、central directoryを64-bit値で扱う                           |
| writer → OPFS backpressure | 最大1 MiBまで出力を集約し、flush時はOPFS write完了を待ってから次のresponse chunkを読み進める          |

既知の入力サイズから算出する必要容量は参考値です。`ZipPassThrough`相当のstore方式では概ね入力合計にlocal header、data descriptor、central directory等が加わりますが、未知のresponse、ファイル名長、ZIP64 extra field、クォータ推定誤差があるため、開始可否の絶対保証には使いません。

初期実装では`unlimitedStorage`を要求しません。このpermissionはCache StorageやOPFSをクォータ・evictionから除外しますが、拡張機能が端末ストレージを際限なく消費するリスクも広げます。実測で通常クォータが要件を満たさない場合だけ、別ADRと利用者向け権限説明を作成して再検討します。

## 7. 技術設計

```text
Popup
  │ START_LARGE_ZIP_EXPORT(candidate IDs)
  ▼
Background Service Worker
  │ 候補再検証・排他・session state
  ▼
Offscreen document
  │ navigator.storage.getDirectory()
  │ createWritable() → job-<random>.zip.part
  │
  ├─ fetch item 1 ─┐
  ├─ fetch item 2 ─┼─ 最大3 requestを先行、entry順にconsume
  └─ fetch item 3 ─┘
                    └─ ZIP64 writer ─ 1 MiB buffer/backpressure ─ OPFS writable
  │ close → getFile() → URL.createObjectURL(File)
  ▼
Background Service Worker
  │ chrome.downloads.download(blob URL)
  ▼
Downloads directory
  │ onChanged complete / interrupted
  ▼
Blob URL revoke + OPFS temp delete + permission release
```

### OPFSを選ぶ理由

- `FileSystemWritableFileStream`へchunkを逐次書き込める。
- 完成後に`FileSystemFileHandle.getFile()`でBlobとして扱える`File`を取得でき、既存のBlob URL保存フローへ接続できる。
- 入力を個別キャッシュしないため、Cache Storage案よりピーク一時容量とI/Oを抑えられる。
- extension originの領域に閉じ、ユーザーが選択していない通常ファイルパスへ直接書き込まない。

`getFile()`、Blob URL、`chrome.downloads`の組み合わせが大容量時にもarchive全体をheapへ複製しないことは仕様から保証しきれないため、技術spikeでChrome Stableのheap・process memory・disk usageを実測します。

### ZIP writer

`fflate 0.8.3`は既存archiveの展開互換性テストに残し、生成側には依存しません。Phase 6ではZIP64のstore方式に限定した小さなwriterを実装しました。

- CRC32を入力chunkごとに更新する
- local file headerとZIP64 data descriptorを逐次出力する
- entry size、offset、central directory size・offsetを`bigint`で保持する
- ZIP64 EOCD、locator、従来EOCDを出力する
- sinkは未書き込みchunkを最大1 MiBまで集約し、flush時はOPFS write完了を待つ
- 圧縮は行わず、画像・動画等の再圧縮コストと一時メモリを避ける

自動テストではZIP64 record、CRC、内容、entry名、backpressureを確認し、`fflate`で生成物を展開しています。4 GiB超の実archiveとOS標準展開機能の互換性はChrome Stable手動ゲートとして残します。

### 取得・書き込み性能

`0.5.0`ではCDN requestを最大3件まで開始し、現在entryのbodyを処理している間に後続responseを待機させます。ZIP writerがconsumeするentryは常に元の選択順で一件だけです。失敗またはキャンセル時は、現在readerと先行response bodyをすべてcancelします。

OPFS sinkは小さなZIP chunkを最大1 MiBまでメモリ内で集約してから一回の`write()`へ渡します。バッファが閾値へ達した場合はwrite完了を待つため、未書き込みデータは有界です。進捗通知は最新状態だけを500ms単位でbackgroundへ送り、`chrome.storage.session`更新が取得・書き込みのクリティカルパスを占有しないようにします。

## 8. 状態とエラー

想定状態:

```ts
type LargeZipStatus =
  | 'estimating'
  | 'fetching'
  | 'writing'
  | 'finalizing'
  | 'saving'
  | 'complete'
  | 'failed'
  | 'cancelled';
```

追加エラーコード:

- `STORAGE_ESTIMATE_FAILED`: 推定情報を取得できない。警告後に続行可能とする。
- `STORAGE_QUOTA_EXCEEDED`: OPFSのクォータ不足。
- `TEMP_WRITE_FAILED`: 一時ZIPのwriteまたはclose失敗。
- `ZIP64_UNSUPPORTED`: writerが必要なZIP64境界を扱えない。
- `TEMP_CLEANUP_FAILED`: 一時ファイル削除に失敗。次回起動時のcleanup対象にする。
- `DOWNLOAD_NO_SPACE`: `chrome.downloads`が保存先容量不足で中断。

エラー表示とsession stateには完全なURL、response header、OPFS内部名、ローカル保存パスを残しません。

## 9. 原子性とcleanup

- 一時ファイル名は推測可能なチャンネル名やファイル名を含めず、job IDだけから生成する。
- writer完了前の`.part`をBlob URLやdownloadsへ渡さない。
- 任意のentry失敗時はwritableをabortし、一時ファイルを削除する。
- download完了・中断を確認するまで一時ファイルとBlob URLを保持する。
- offscreen起動時に既知prefixの孤児`.part`を削除する。進行中job IDと一致するものは削除しない。
- cleanup失敗は保存成功と分離して記録するが、次回cleanupを必ず再試行する。
- 拡張機能uninstall時のorigin storage削除はChromeに委ねる。

## 10. テスト計画

### 自動テスト

- 0 / 1 / 100 / 101 / 500 entryでZIP固有の件数拒否がないこと
- 4 GiB境界の直前・直後を実データなしのsynthetic offsetで検証するZIP64テスト
- 65535 / 65536 entry境界をwriter単体で検証するテスト
- response chunkとOPFS writeのbackpressureにより未書き込み量が有界であること
- `Content-Length`欠損・不正・過少・過大申告でも実読込・実出力値を追跡すること
- `QuotaExceededError`、write失敗、close失敗、fetch失敗、redirect拒否、キャンセルで保存を開始しないこと
- 全失敗経路でreader、writer、writable、Blob URL、一時ファイル、任意権限を解放すること
- 次回起動時に孤児一時ファイルを削除すること
- ZIP64対応展開器でentry名、CRC、内容、サイズが一致すること

`0.5.0`実装時点の結果:

- 500 entryをZIP固有の件数拒否なしで生成・展開: Pass
- ZIP64 EOCD、locator、central directoryの64-bit field: Pass
- CRC、UTF-8 entry名、内容一致: Pass
- sink writeのbackpressure: Pass
- 最大3 requestの先行取得、entry順序維持、失敗時の全response cancel: Pass
- 1 MiB未満のOPFS write集約: Pass
- OPFS write、close、abort、remove、孤児cleanup: Pass
- `QuotaExceededError`から`STORAGE_QUOTA_EXCEEDED`への変換: Pass
- network request・response stream例外から`FETCH_FAILED`への変換: Pass

`0.5.1`で追加した自動境界検証:

- 4 GiB直前・超過のentry sizeをZIP64 extra fieldへ保持: Pass
- 4 GiB超のlocal header・central directory offsetとZIP64 locator: Pass
- 65,535件・65,536件のZIP64 entry count: Pass
- 101件のfetch → ZIP64 writer → OPFS adapter → `File` → 展開: Pass
- cleanup失敗件数の返却と次回起動相当の再試行: Pass
- `chrome.downloads`の`FILE_NO_SPACE`表示とservice worker状態復元: Pass
- `navigator.storage.estimate()`の推定空き容量表示: Pass

`0.6.0`で追加した出力回帰:

- 選択操作の順序にかかわらずregistryへの取得順で候補を解決: Pass
- ZIP内ファイル名を`001_`から最大`500_`までの連番にする: Pass
- OPFSの`File.type`が空でも完成Blobを`application/zip`に固定: Pass

`LZIP-07`のうち`navigator.storage.estimate()`による推定空き容量表示は実装済みです。開始前の既知`Content-Length`合計は、追加のHEAD requestや事前GETを行わずに候補情報だけから取得できないため、`0.5.0`では表示しません。選択件数、推定空き容量、処理中の実入力・実出力バイト数を表示し、既知サイズ合計はShould要件のfollow-upとして残します。

### Chrome Stable手動テスト

- 101件と500件の小ファイル
- 100 MiB、1 GiB、4 GiB直前、4 GiB超のarchive
- 1件の大容量ファイルと、多数の小容量ファイル
- `navigator.storage.estimate()`表示と実際のOPFS使用量
- DevToolsによるJavaScript heap、process memory、OPFS disk usage、所要時間、キャンセル応答
- quota不足、保存先disk不足、Chrome終了、extension reload
- Windows/macOS/Linux標準展開機能および代表的なZIP64対応ツールでの展開

4 GiB超の実データ試験は権利が明確なローカルfixtureまたは生成データを使用し、Discordへ巨大なテストファイルをアップロードしません。

## 11. 完了条件

- LZIP-01からLZIP-15を満たす。
- ZIP固有の100件・50 MiB・100 MiB固定上限を実装とUIから削除する。
- 101件と500件が一つのZIPとして保存・展開できる。
- 4 GiB超のZIP64 archiveを生成・展開できる。
- 大容量処理中もJavaScript heapがarchiveサイズに比例して増加しない。
- quota・disk不足を再現し、不完全ZIPをDownloadsへ残さない。
- 全終端状態と次回起動時の一時ファイルcleanupを確認する。
- 新しいpermissionを追加しない。追加が必要になった場合は別ADRで再承認する。
- Project ownerが実測結果、ZIP64 writer、ストレージ説明を承認する。

## 12. 参考資料

- [Chrome Extensions: Storage and cookies](https://developer.chrome.com/docs/extensions/develop/concepts/storage-and-cookies)
- [Chrome Extensions: Permissions list (`unlimitedStorage`)](https://developer.chrome.com/docs/extensions/reference/permissions-list)
- [Chrome Extensions: `chrome.downloads`](https://developer.chrome.com/docs/extensions/reference/api/downloads)
- [Chrome Extensions: `chrome.offscreen`](https://developer.chrome.com/docs/extensions/reference/api/offscreen)
- [Chrome Developers: File System Access API / OPFS](https://developer.chrome.com/docs/capabilities/web-apis/file-system-access)
- [web.dev: The origin private file system](https://web.dev/articles/origin-private-file-system)
- [web.dev: Storage for the web](https://web.dev/articles/storage-for-the-web)
- [fflate official repository](https://github.com/101arrowz/fflate)
