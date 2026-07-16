# Discord Media Exporter 0.6.1 リリースノート

## 概要

内部実装を整理し、保守時に関数の責務と副作用を追いやすくしたパッチリリースです。

利用者向けの機能、画面操作、収集対象、保存形式は変更していません。

## 変更

- 主要な関数とメソッドへJSDocを追加
- backgroundのリクエスト振り分けを専用関数へ分離
- popupの候補行と進捗行のDOM生成を小さな関数へ分離
- offscreenのZIPエラー分類を専用関数へ分離
- メディアURL取得処理の冗長な分岐を除去

## 維持する境界

- ユーザーの明示操作を起点に収集と保存を実行
- Discord画面の可視範囲にある添付だけを収集
- Discord内部API、token、Cookieを不使用
- 無人の連続scrollと定期巡回を不使用
- permission、通信先、ZIP形式、OPFS処理の変更なし

## 検証

- lint
- TypeScript型検査
- 単体テスト
- Prettier整形チェック
- production build
