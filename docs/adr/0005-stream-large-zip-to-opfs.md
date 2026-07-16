# ADR-0005: 大容量 ZIP を OPFS へ直接ストリーミングする

- Status: Accepted
- Date: 2026-07-16
- Decision owners: Project owner
- Accepted: 2026-07-16

## Context

Phase 5 の ZIP writer はCDN responseを一件ずつ読みますが、生成されたZIP chunkを`BlobPart[]`へ追加し、完成までJavaScript側で保持します。そのため100件、1ファイル50 MiB、入力合計100 MiBの固定上限を設けています。

Phase 6ではZIP固有の固定件数・バイト上限を外し、選択された全候補を処理したいという要求があります。入力メディアをCache Storageへ一件ずつ保存し、最後にZIP化する案もあります。

## Decision

Cache Storageへの入力response保存は採用しません。CDN responseを一件ずつ取得してZIP64 streaming writerへ渡し、writerの出力chunkをOrigin Private File System（OPFS）のジョブ専用一時ファイルへ直接書き込みます。

- 入力メディアをCache Storage、IndexedDB、`chrome.storage`へ複製しない
- ZIP64対応writerを必須とする
- writer出力とOPFS writeの間にbackpressureを設ける
- ZIP全体をJavaScript heapへ保持しない
- 全entryとZIP終端構造の書き込み成功後だけ、OPFSの`File`からBlob URLを作成する
- `chrome.downloads`完了・中断後にBlob URLと一時ファイルを削除する
- 固定の100件・50 MiB・100 MiB上限は廃止する
- 候補registryの500件上限は別の安全境界として維持する
- origin quota、物理disk、ネットワーク、ZIP形式の実行時失敗は残るため、「無制限」とは表現しない
- 初期実装では`unlimitedStorage`permissionを追加しない

詳細要件は[Phase 6: 全選択候補のディスクストリーミング ZIP](../large-zip-export.md)に従います。

## Rationale

### Cache Storageを採用しない理由

- 完成直前に入力キャッシュと一時ZIPを同時保持し、ピークdisk usageが増える
- 入力を再読込するためI/Oが増える
- Cache StorageもOPFSも同じextension originのquota管理を受け、サイズ制約を消せない
- response cacheは最終ZIPのstreaming output、ZIP64、downloads連携を解決しない

### OPFSへZIPを直接書く理由

- chunk単位のwriteとbackpressureを構成できる
- 一時領域を概ね完成ZIP一つ分に抑えられる
- 完成後の`File`をBlobとして既存のBlob URL保存経路へ接続できる
- extension origin内に閉じ、任意のユーザーファイルパスへ直接書かない

## Consequences

### Positive

- archiveサイズに比例するJavaScript heap増加を避けられる
- ZIP固有の100件・100 MiB上限を撤廃できる
- 取得、ZIP生成、disk writeを一つのpipelineとして処理できる
- 入力responseの二重保存を避けられる

### Negative

- quota不足、disk不足、OPFS eviction、write/close失敗を扱う必要がある
- 一時ファイルcleanupと孤児回収が必要になる
- 4 GiB超に対応するZIP64 writerの選定または実装が必要になる
- OPFS `File`からBlob URLを作る最終段階が大容量時にheap copyを発生させないか、Chrome Stable実測が必要になる
- 生成中のChrome終了・extension reloadからは再開できない

## Rejected alternatives

### 入力responseをCache Storageへ保存してからZIP化

入力合計と完成ZIPの両方を一時保持し、quotaとI/Oを余分に消費するため採用しません。

### 現行`BlobPart[]`方式のまま上限だけ削除

archive全体がheapまたはBlob構築用メモリへ蓄積し、タブ・offscreen processの停止につながるため採用しません。

### `unlimitedStorage`permissionを最初から要求

quota問題を隠して端末diskを過剰消費する範囲を広げます。通常quotaでの実測前には採用しません。

### ユーザー可視ファイルへ直接書き込むFile System Access API

保存先handle、権限prompt、offscreenとの連携が増え、既存の`chrome.downloads`方針を変えます。OPFS + downloadsのspikeが成立しない場合の代替案とします。

## Implementation and release gates

このADRのAcceptedは、OPFSへZIP64を直接streaming writeする設計方針の承認を表します。次の項目はADRの採否条件ではなく、Phase 6を実装済み・リリース可能と判断するためのゲートです。

- OPFSへZIP chunkを逐次書き込む技術spikeが成功する
- ZIP64 writer候補のlicense、security、bundle、互換性レビューが完了する
- 101件、500件、1 GiB、4 GiB超でheap・disk・所要時間を計測する
- quota不足、disk不足、キャンセル、context消失、cleanupを再現する
- Windows/macOS/Linuxで生成ZIPを展開できる
- 新しいpermissionなしで要件を満たせることを確認する
