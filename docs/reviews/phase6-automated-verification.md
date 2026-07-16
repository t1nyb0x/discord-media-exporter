# Phase 6 自動検証記録

- 実施日: 2026-07-16
- 対象バージョン: `0.5.0`
- 状態: Automated verification passed / Chrome Stable large-volume verification pending

## 対象

- ZIP固有の100件、1ファイル50 MiB、入力合計100 MiB固定上限の撤廃
- store方式ZIP64 streaming writer
- OPFS一時ファイルへの逐次出力とbackpressure
- quota・write failure・キャンセル時の原子性
- download終了後と次回offscreen起動時の一時ファイルcleanup
- 入力・ZIP出力バイト数と推定一時空き容量の表示

## 自動検証結果

- `pnpm lint`: Pass
- `pnpm typecheck`: Pass
- `pnpm test`: Pass（16 files / 58 tests）
- `pnpm format:check`: Pass
- production build: Pass
- `discord-media-exporter-0.5.0-chrome.zip`生成: Pass
- 配布物manifest・不要ファイル・version検証: Pass
- SHA-256生成・照合: Pass

## 主な確認内容

- 500 entryをZIP固有の件数拒否なしで生成し、全entryを展開できる
- ZIP64 EOCD、locator、central directoryに64-bit値を出力する
- entry名、CRC32、内容、出力サイズが一致する
- sinkの`write()`完了前に次のchunkを進めず、backpressureを維持する
- 同時request数を最大3件に制限し、ZIP entry順序を維持する
- write失敗時に現在readerと先行response bodyをすべてcancelする
- 1 MiB未満のZIP chunkを一回のOPFS writeへ集約する
- OPFS一時ファイルをwrite、close、getFile、abort、removeできる
- 次回起動時に既知prefixの孤児一時ファイルだけを削除する
- `QuotaExceededError`を`STORAGE_QUOTA_EXCEEDED`として扱う
- OPFS write/close失敗を`TEMP_WRITE_FAILED`として扱う
- request・response streamの例外を`FETCH_FAILED`として扱う
- 失敗時にsinkをabortし、完成ZIPを保存しない
- `unlimitedStorage`と新しいhost permissionを追加していない

## 自動検証の限界

自動テストのZIP64 record確認は、実データを4 GiBまで生成する試験ではありません。生成物を`fflate`で展開して互換性を確認していますが、ChromeのOPFS、Blob URL、`chrome.downloads`が大容量時にもarchive全体をheapへ複製しないことや、OS標準展開機能のZIP64対応までは証明しません。

`navigator.storage.estimate()`の推定空き容量は表示しますが、候補情報にサイズがないため、開始前の既知`Content-Length`合計表示は未実装です。追加のHEAD requestや事前GETを導入する前に、CDN互換性と二重通信をレビューするfollow-upとします。

## 残る手動リリースゲート

- Chrome Stableで101件と500件を保存・展開する
- 100 MiB、1 GiB、4 GiB直前、4 GiB超を保存・展開する
- JavaScript heap、process memory、OPFS使用量、所要時間、キャンセル応答を記録する
- quota不足と保存先disk不足で不完全ZIPが残らないことを確認する
- Chrome終了、extension reload、download中断後の一時ファイルcleanupを確認する
- Windows/macOS/Linux標準展開機能と代表的ZIP64対応ツールで展開する

Chromeバージョン、OS、測定値、展開ツールは実施時に追記し、未実施項目を推測で補完しません。
