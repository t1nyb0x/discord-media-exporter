# ADR-0003: メディア ZIP を拡張機能内で生成する

- Status: Proposed
- Date: 2026-07-15
- Decision owners: Project owner

## Context

複数の選択項目を個別ダウンロードすると、Chrome のダウンロード一覧と保存先に多数のファイルが並び、後から一つのまとまりとして扱いにくくなります。一方、ZIP 化にはメディア本体の取得、メモリ管理、追加のホストアクセス、生成途中の失敗処理が必要です。

現行方式は `chrome.downloads` に CDN URL を渡しており、拡張機能自身は response body を読みません。ZIP を生成するにはこのデータ境界が変わるため、保存形式だけの UI 変更として扱わず、権限と処理場所を決定する必要があります。

## Proposed decision

個別保存を維持したまま、ユーザーが明示的に選んだ場合だけメディア ZIP を拡張機能内で生成します。

- `cdn.discordapp.com` と `media.discordapp.net` だけを `optional_host_permissions` に宣言し、ZIP 開始時に要求して終端状態で解放する
- background service worker が候補検証、排他制御、状態管理を行う
- `offscreen` permission と `BLOBS` reason で作成した offscreen document が、逐次 fetch、ZIP writer、Blob URL 生成を行う
- 一件でも取得・検証に失敗した場合は ZIP を保存しない
- 初期上限を 100 件、一件 50 MiB、合計 100 MiB とし、実装 spike の計測で維持または引き下げる
- 取得時は認証情報を付与せず、許可ホストと attachment path を redirect 後にも再検証する
- 外部 ZIP サービス、クラウド保存、リモートコードを使わない

詳細は[メディア ZIP 出力仕様](../zip-export.md)に従います。この ADR は、権限説明、メモリ計測、依存ライブラリのレビュー方法を Project owner が承認した時点で Accepted に変更します。

実装spikeでは`fflate 0.8.3`のstreaming APIとWXTのunlisted offscreen pageで成立することを自動テスト・production buildまで確認しました。Chrome Stableでの25 / 50 / 100 MiB計測と実Discord手動確認が完了するまでStatusはProposedを維持します。

## Consequences

### Positive

- 選択したファイルを一つの保存物として扱える
- メディア本体を開発者または第三者のサーバーへ送らない
- popup の寿命と ZIP 生成の寿命を分離できる
- ZIP 権限を拒否しても既存の個別保存を利用できる
- ZIP バッチ後に CDN へのアクセス権限を残さない

### Negative

- `offscreen` permission と CDN への任意ホスト権限が増える
- ZIP 保存のたびに Chrome の権限確認が表示される
- ZIP の完成まで最大 100 MiB と生成データを拡張機能プロセスが扱う
- 期限付き URL が途中で失効すると ZIP 全体を再実行する必要がある
- Chrome 終了や拡張機能更新をまたぐ再開はできない
- ZIP writer の依存関係または独自バイナリ実装を保守する必要がある

## Rejected alternatives

### 外部サービスで ZIP 化する

メディア URL または内容を第三者へ送信し、現在のローカル処理・外部送信なしという方針に反するため採用しません。

### popup 内で生成する

popup を閉じると処理 context が破棄され、大きな ZIP の生成中断や Blob URL の管理が不安定になるため採用しません。

### Discord ページへ ZIP ライブラリを注入する

ページ origin、CSP、ページ側スクリプトの影響を受け、拡張機能の検証境界も曖昧になるため採用しません。

### 先に個別ファイルとして保存し、後から読み直す

拡張機能が任意のローカルダウンロードファイルを安全に読み直す単純な経路がなく、一時ファイルの削除や権限も増えるため採用しません。

### 成功項目だけを含む部分 ZIP

ユーザーが選択した集合と保存物の内容が一致しないまま成功に見えるため、Phase 5 では採用しません。

## Revisit triggers

- 100 MiB 未満でも Chrome の安定性やキャンセル応答を確保できない
- offscreen document または Blob URL の Chrome 仕様が変わる
- CDN 取得に Cookie、広い host permission、通常ページへのコード注入が必要になる
- streaming を使っても peak memory を明確に制限できない
- 大容量、暗号化、分割 ZIP、処理再開が必須要件になる
