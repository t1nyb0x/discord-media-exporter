# Phase 7 自動検証記録

- 実施日: 2026-07-16
- 対象バージョン: `0.6.0`
- 状態: Automated verification passed / Guided collection real-device verification passed / Spoiler and ZIP output fixes pending recheck

## 対象

- scrollableなmessage containerの特定
- 一回のユーザー操作に対する一回のscroll
- 表示高80%の移動量
- 上端とcontainer不明時の安全な失敗
- Shadow DOMガイド、停止、500件到達
- チャンネル変更時のcollector・ガイドcleanup
- 既存の手動scroll収集、個別保存、ZIP保存の回帰
- 明示操作による可視スポイラー解除

## 自動検証結果

- `pnpm lint`: Pass
- `pnpm typecheck`: Pass
- `pnpm test`: Pass（18 files / 73 tests）
- `pnpm format:check`: Pass
- production build: Pass
- `discord-media-exporter-0.6.0-chrome.zip`生成: Pass
- 配布物manifest・不要ファイル・version検証: Pass
- SHA-256生成・照合: Pass

## 確認内容

- scrollableなancestorを優先して選択する
- 1600pxの位置から700px表示領域の80%である560pxだけ戻る
- 一回のbutton clickでstep callbackを一回だけ呼ぶ
- 上端ではscroll eventを生成せず、自動再試行しない
- containerがなければDOMを変更せず`unavailable`を返す
- 500件到達時にstep buttonを無効化する
- 停止操作でガイドhostを削除する
- チャンネル変更によるcollector停止時にcleanup callbackを一回呼ぶ
- runtime messageの停止後にガイドが残らない
- ZIP候補をregistryへの取得順で解決し、`001_`から連番を付ける
- OPFS完成BlobのMIME typeを`application/zip`に固定する
- aria-labelの`spoiler`・`スポイラー`・`ネタバレ`で確認した可視スポイラーだけを一回最大50件clickする
- 実DOMと同じ`role="button"`、`aria-label="ネタバレ"`、`aria-expanded="false"`の要素を対象にする
- `aria-expanded="true"`の解除済みスポイラーは再clickしない
- 画面外と通常buttonをclickせず、500件到達時は解除buttonを無効化する

## 自動検証の限界

happy-dom fixtureはDiscord本番のvirtualized list、古い投稿の追加読込、CSS、重なり順を再現しません。実Discordでscroll container、移動方向、追加描画後のscroll位置、ガイドの配置を確認する必要があります。

2026-07-16にProject ownerからガイド付き収集を実機確認済みとの報告を受けました。確認中に、ZIP内順序と完成archiveが`.txt`として扱われる問題が見つかったため、registry順の連番と`application/zip`固定を追加しました。その後、明示操作による表示中スポイラー解除も追加しました。これらは修正後の実機再確認対象です。
