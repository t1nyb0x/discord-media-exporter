# メディア ZIP 出力仕様

## 1. 位置づけ

この文書は Phase 5 で追加する「メディア ZIP」の要件、制約、設計、検証項目を定義します。WXT が生成する拡張機能の配布 ZIP とは別物です。この文書では次の用語を使い分けます。

実装状況: 自動テストとproduction buildは完了しています。Chrome Stableでの容量別計測と実Discord手動確認は未完了です。

- メディア ZIP: ユーザーが選択した Discord 添付を一つにまとめた保存物
- 配布 ZIP: 拡張機能を unpacked install するためのリリース成果物

ZIP 出力は保存形式を増やすだけで、スキャン範囲や取得元を増やしません。[ADR-0001](adr/0001-user-initiated-dom-export.md) の「現在表示中で、ユーザーが選択したメディアだけ」という境界を維持します。

## 2. ユーザー価値とスコープ

### 含むもの

- 選択済み候補を一つの `.zip` として保存する
- 個別保存と ZIP 保存を実行前に選べる UI
- 取得、格納、ZIP 保存の進捗表示
- ユーザーによる処理のキャンセル
- ZIP 内の安全で一意なファイル名
- popup を閉じても、開始済みの処理を継続して状態を再表示する
- 件数・バイト数の上限を超える処理を安全に中止する

### 含まないもの

- 画面外の添付、自動スクロール、履歴収集
- ZIP の暗号化、パスワード設定、分割 ZIP、ZIP64
- フォルダー構造、チャンネル名、投稿者名、投稿時刻の格納
- メッセージ本文や一覧 manifest の同梱
- 失効 URL の復元、認証情報を使った再取得
- Chrome または拡張機能を終了した後の生成再開

個別保存は廃止せず、ZIP 用の権限を許可しない利用者も従来機能を使えるようにします。

## 3. ユーザーフロー

1. ユーザーが自動収集を開始し、手動スクロール中に同じチャンネルで累積した候補から対象を選択する。
2. 「個別に保存」または「ZIP にまとめて保存」を選ぶ。
3. ZIP を選んだ場合だけ、対象件数、上限、権利上の注意、追加のホストアクセス理由を表示する。
4. ユーザーの操作を起点に、popup から `cdn.discordapp.com` と `media.discordapp.net` への任意ホスト権限を要求する。
5. 許可された場合、拡張機能は選択項目を一件ずつ取得し、メディア ZIP を生成する。
6. 全項目の取得と ZIP 検証が成功した後だけ、`chrome.downloads` で ZIP の保存を開始する。
7. 完了、失敗、キャンセルの終端状態で任意ホスト権限を解放し、結果を表示する。

権限が拒否された場合は処理を開始せず、個別保存が引き続き利用できることを案内します。最小権限を優先し、許可は ZIP バッチごとに要求して処理後に自動で解放します。そのため、次回の ZIP 保存時には Chrome の権限確認が再度表示されます。

## 4. 機能要件

| ID     | 要件                                                                                             | 優先度 |
| ------ | ------------------------------------------------------------------------------------------------ | ------ |
| ZIP-01 | ユーザー開始後の可視範囲監視で background が再検証・登録したセッション候補 ID だけを受け付ける   | Must   |
| ZIP-02 | ZIP 保存の直前に任意ホスト権限を要求し、拒否時は取得せず、全終端状態で権限を解放する             | Must   |
| ZIP-03 | 取得時も HTTPS、ホスト、`/attachments/` パスを検証し、redirect 後の最終 URL も同じ条件で検証する | Must   |
| ZIP-04 | リクエストへ Cookie や Authorization header を明示的に付与せず、`credentials: 'omit'` を使用する | Must   |
| ZIP-05 | ZIP 内の名前を再サニタイズし、衝突時は拡張子の前へ ` (2)`, ` (3)` のような連番を付ける           | Must   |
| ZIP-06 | 全項目が成功するまで保存を開始せず、一件でも失敗した場合は不完全な ZIP を保存しない              | Must   |
| ZIP-07 | 件数、処理中ファイル名、取得済みバイト数、完了・失敗状態を表示する                               | Must   |
| ZIP-08 | ユーザーが生成をキャンセルでき、進行中の `fetch()` と未開始の処理を停止できる                    | Must   |
| ZIP-09 | ZIP 名を `discord-media-YYYYMMDD-HHmmss.zip` とし、チャンネル名やユーザー名を含めない            | Must   |
| ZIP-10 | 同時に一つの保存バッチだけを実行し、個別保存と ZIP 保存を並行実行しない                          | Must   |
| ZIP-11 | popup を閉じて再度開いた時に、セッション内の進捗を再表示する                                     | Must   |
| ZIP-12 | ZIP の内容を外部サービスへ送信せず、拡張機能内で生成する                                         | Must   |

## 5. リソース上限

最初の実装では次のハード上限を設けます。候補一覧全体の上限 500 件とは別の制約です。

| 対象               | 上限     | 判定方法                                                          |
| ------------------ | -------- | ----------------------------------------------------------------- |
| 選択件数           | 100 件   | 開始前に拒否                                                      |
| 一ファイルの取得量 | 50 MiB   | `Content-Length` があれば取得前、なければ stream 読み取り中に判定 |
| バッチ全体の取得量 | 100 MiB  | 各 response body の実読込バイト数を加算して判定                   |
| ZIP エントリー名   | 180 文字 | 既存ファイル名サニタイズ後に一意化                                |

`Content-Length` は信用せず、欠損・不正・実データとの差異があっても実際に読み込んだバイト数で必ず停止します。上限超過時は ZIP 全体を失敗とし、取得済みバッファと Blob URL を破棄します。

100 MiB は初期の安全上限であり、対応可能容量の保証値ではありません。実装 spike で 25 / 50 / 100 MiB、圧縮済み画像・動画、キャンセル、低メモリ条件を計測し、Chrome が不安定になる場合はリリース前に上限を下げます。上限を上げる場合はセキュリティ・性能レビューを再実施します。

## 6. 技術設計

```text
Popup UI
  │ START_ZIP_EXPORT (candidate IDs)
  ▼
Background Service Worker
  │ 候補再検証・排他制御・状態永続化
  │ offscreen document の生成
  ▼
Offscreen ZIP Worker
  │ 許可済み Discord CDN から逐次 fetch
  │ byte limit・最終 URL・ファイル名を検証
  │ streaming ZIP writer → Blob
  ▼
Background Service Worker
  │ chrome.downloads.download(blob URL)
  ▼
ローカルのメディア ZIP
```

### Background Service Worker

- 既存の候補 registry から ID を引き直し、URL とファイル名を再検証する
- 個別保存と ZIP 保存の共通バッチ排他を管理する
- `chrome.storage.session` には候補、件数、バイト数、状態、エラーコードだけを保持する
- offscreen document が消失した状態を検知した場合は再開せず失敗へ遷移させる
- Blob URL は ZIP のダウンロード完了または失敗後に revoke し、offscreen document を閉じる

`chrome.permissions.request()` はユーザー操作が必要なため、popup の ZIP 開始 click handler から直接呼びます。許可後に candidate ID だけを background へ渡します。background は終端状態で `chrome.permissions.remove()` を呼び、popup が途中で閉じた場合も権限を解放します。

### Offscreen document

Manifest V3 の service worker では利用できない Blob URL の生成を担当します。`offscreen` permission と `BLOBS` reason を使い、ZIP バッチが存在する間だけ生成します。通常の DOM 走査には使いません。

取得は一件ずつ行い、全ファイルを同時にメモリへ置きません。ZIP writer は entry を逐次受け取れるものを使い、既に圧縮されていることが多い画像・動画を再圧縮して CPU とメモリを浪費しない設定を既定にします。

ZIP writerにはMITライセンスの`fflate 0.8.3`を固定して採用しました。非圧縮の`ZipPassThrough`を使い、次の条件を満たすことを配布物と自動テストで確認します。

- runtime code をパッケージへ静的に同梱できる
- `eval`、リモートコード、外部通信を使わない
- stream/chunk 単位で entry を追加できる
- CRC32、UTF-8 ファイル名、空ファイルを扱える
- lockfile 固定、ライセンス・配布物・既知脆弱性のレビューを実施できる

ライブラリを自作 ZIP writer に置き換える場合も、CRC、central directory、破損・境界値テストを同じ受け入れ条件に含めます。

### メッセージと状態

既存メッセージへ次を追加します。実装時は discriminated union と受信側検証を維持します。

```ts
type ZipExportStatus =
  'requesting_permission' | 'fetching' | 'packing' | 'saving' | 'complete' | 'failed' | 'cancelled';

type ZipExportRequest =
  | { type: 'START_ZIP_EXPORT'; candidateIds: string[] }
  | { type: 'CANCEL_ZIP_EXPORT' }
  | { type: 'GET_EXPORT_STATUS' };
```

エラーは `PERMISSION_DENIED`, `FETCH_FAILED`, `INVALID_REDIRECT`, `ITEM_TOO_LARGE`, `BATCH_TOO_LARGE`, `ZIP_FAILED`, `SAVE_FAILED`, `CONTEXT_LOST` のような URL を含まない内部コードから、日本語表示へ変換します。完全な URL、response header、ローカルパスを状態やログへ残しません。

## 7. 失敗・キャンセル・復旧

- 403 / 404 / network error / 不正 redirect: その場で全体を中止し、対象の安全なファイル名と一般化した理由を表示する
- 上限超過: `AbortController` で読み取りを止め、生成途中のデータを破棄する
- ユーザーキャンセル: 状態を `cancelled` にし、メディア ZIP を保存しない
- popup close: offscreen と background の処理は継続する
- service worker restart: offscreen context と session state を照合する。処理 context がなければ `CONTEXT_LOST` で終了する
- Chrome 終了、拡張機能 reload/update: 再開しない。次回表示時に再実行を案内する
- ZIP 生成後の `chrome.downloads` 失敗: Blob URL を破棄し `SAVE_FAILED` とする

不完全な ZIP を「成功」として残さないことを優先し、Phase 5 では成功項目だけを含む部分 ZIP は提供しません。

## 8. テスト計画

### 単体テスト

- ZIP 内ファイル名のサニタイズ、衝突、拡張子保持、UTF-8、空ファイル
- 件数、単体バイト数、合計バイト数の境界値
- `Content-Length` の欠損、不正値、過少申告
- redirect 後 URL の再検証
- 状態遷移、二重開始、個別保存との排他、キャンセル
- エラーと保存状態に URL が含まれないこと

### 統合テスト

- background と offscreen document のメッセージング
- 任意ホスト権限の許可・拒否
- 取得途中の 403、network error、上限超過で ZIP が保存されないこと
- 生成された ZIP の展開、entry 件数、ファイル名、CRC、内容一致
- popup close/reopen と service worker restart の状態照合
- Blob URL の revoke と offscreen document の終了
- 完了、失敗、キャンセル、context 消失後の任意ホスト権限解放

### 手動テスト

- Chrome Stable で画像、動画、その他添付を混在させた ZIP を保存・展開する
- 日本語名、同名、長い名前、空ファイルを確認する
- 25 / 50 / 100 MiB の peak memory、所要時間、キャンセル応答を計測する
- 権限ダイアログの前後で、個別保存が影響を受けないことを確認する
- DevTools の Network と配布物を確認し、許可 CDN 以外への通信がないことを確認する

## 9. Phase 5 の完了条件

- ZIP-01 から ZIP-12 と ZIP 受け入れ条件を満たす
- 全自動検査と production build が成功する
- 100 MiB までの性能計測結果と、採用した上限の根拠をレビュー記録へ残す
- 新しい `offscreen` permission と任意ホスト権限を UI、README、セキュリティ文書、配布物で説明する
- ZIP ライブラリを使う場合は、ライセンス、lockfile、脆弱性、生成 bundle をレビューする
- 実 Discord の権利が明確なテストメディアで手動確認する
- Discord の規約と ADR-0001 の境界を再確認する

## 10. 参考資料

- [Chrome Extensions: Cross-origin network requests](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests)
- [Chrome Extensions: Declare permissions](https://developer.chrome.com/docs/extensions/develop/concepts/declare-permissions)
- [Chrome Extensions: `chrome.permissions`](https://developer.chrome.com/docs/extensions/reference/api/permissions)
- [Chrome Extensions: `chrome.offscreen`](https://developer.chrome.com/docs/extensions/reference/api/offscreen)
- [Chrome Extensions: `chrome.downloads`](https://developer.chrome.com/docs/extensions/reference/api/downloads)
