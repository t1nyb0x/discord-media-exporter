# Discord Media Exporter 0.5.0 リリースノート

## 概要

選択したメディアのZIP出力を、メモリ内へ完成ZIPを蓄積する方式から、ZIP64をOrigin Private File System（OPFS）の一時ファイルへ逐次書き込む方式へ変更しました。ZIP固有の100件、1ファイル50 MiB、入力合計100 MiBの固定上限を撤廃し、候補registryの既存上限500件まで選択した全候補を処理します。

「固定上限なし」は無制限保存を意味しません。実際に保存できる量はChromeが割り当てるOPFSクォータ、端末の空き容量、取得元URLの有効性に依存します。

## 追加・変更

- store方式のZIP64 streaming writer
- CDN responseからZIP writer、OPFS一時ファイルへ順番に流すbackpressure付き処理
- 最大3件のCDN requestを先行開始し、ZIP entry順を維持したまま通信待ちを短縮
- 小さなOPFS writeを最大1 MiBまで集約
- 進捗通知とsession状態保存を500ms単位で集約
- ZIP固有の件数・単体容量・合計容量の固定上限撤廃
- 開始前のOPFS推定空き容量表示
- 入力バイト数とZIP出力バイト数の進捗表示
- quota不足と一時ファイルwrite失敗のエラー表示
- 成功・失敗・キャンセル・download終了後と次回offscreen起動時の一時ファイルcleanup

## 維持する境界

- 候補収集は同じチャンネルで実際に表示された項目だけ
- 候補registryは1チャンネル最大500件
- ZIP利用時だけDiscord CDN 2ホストへの任意権限を要求
- Cookie、Authorization header、Discord内部API、外部ZIPサービスを不使用
- `unlimitedStorage`を追加しない
- 一件でも失敗した場合は不完全ZIPを保存しない

## 自動検証

- 500件の候補を一つのZIPとして生成・展開
- ZIP64 EOCD、locator、central directoryの64-bit field
- CRC、UTF-8ファイル名、内容一致
- OPFS writeのbackpressure
- 最大3件の先行取得と、失敗・キャンセル時の先行response解放
- OPFSへの小chunk集約
- OPFS close、abort、remove、孤児一時ファイルcleanup
- quota不足、write失敗、取得失敗、redirect拒否、キャンセル
- 既存の個別保存、自動収集、ZIP状態管理の回帰

## 実機確認待ち

- Chrome Stableでの101件・500件
- 100 MiB、1 GiB、4 GiB直前、4 GiB超のarchive
- quota不足、保存先disk不足、Chrome終了、extension reload
- 大容量処理時のJavaScript heap、process memory、OPFS使用量
- Windows/macOS/Linux標準展開機能と代表的ZIP64対応ツール

開始前にはOPFSの推定空き容量を表示しますが、候補情報にファイルサイズがないため、既知`Content-Length`の合計表示は本リリースに含みません。処理開始後は実際に読み込んだ入力バイト数とZIP出力バイト数を表示します。

実機検証が完了するまでは、大容量ZIPの互換性と安定性を保証済みとは扱いません。
