# Discord Media Exporter 0.4.1 リリースノート

## 概要

自動収集が継続中にもかかわらず、時間を置いてpopupを再表示するとボタンが「自動収集を開始」のOFF状態になる問題を修正しました。収集処理そのものは継続していましたが、UI表示が実際のcollector状態と一致していませんでした。

## 修正

- 注入済みcollectorの状態確認と停止応答を`Promise<CollectorResponse>`で返す
- collector用として認識したruntime messageだけに応答し、他のextension messageを妨げない
- popup再表示時にcollectorが動作中なら「自動収集を停止」と表示する

## 回帰テスト

- popup再表示時のON状態復元
- ON状態から停止操作を行った場合にcollectorへ停止要求を送ること
- collector entrypointの状態・停止応答がPromiseで返ること
- 既存の自動収集、候補累積、個別保存、メディアZIP保存

## 実機確認

2026-07-16にProject ownerが、時間を置いてpopupを再表示した場合もボタンがON状態を正しく反映することを確認しました。

## Phase 6文書

次期Phase 6として、ZIP固有の100件・50 MiB・100 MiB固定上限を廃止するためのOPFS・ZIP64設計文書とADR-0005を追加しています。Phase 6の実装は本リリースには含まれません。
