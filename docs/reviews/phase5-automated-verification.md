# Phase 5 自動検証記録

- 実施日: 2026-07-15
- 対象バージョン: `0.3.0`
- 状態: Automated verification passed / Manual verification pending

## 実装済み

- 個別保存とメディアZIP保存の選択
- popupのユーザー操作からの任意ホスト権限要求
- offscreen documentでの逐次取得、ZIP生成、Blob URL管理
- `credentials: 'omit'`とredirect後のDiscord添付URL再検証
- 100件、単体50 MiB、合計100 MiBのハード上限
- ZIP内ファイル名のサニタイズと大文字・小文字を区別しない一意化
- 進捗、キャンセル、popup再表示、service worker再起動時の状態照合
- 失敗時に部分ZIPを保存しない処理
- 完了、失敗、キャンセル後の任意権限・Blob URL・offscreen document解放
- `fflate 0.8.3`の固定とMITライセンス通知の配布物同梱
- 同じチャンネルでの複数回確認による候補累積、popup再表示時の復元、明示クリア
- チャンネル単位の分離とセッション候補500件上限

## 自動検証結果

- `pnpm lint`: Pass
- `pnpm typecheck`: Pass
- `pnpm test`: Pass（12 files / 41 tests）
- `pnpm format:check`: Pass
- `pnpm zip`: Pass
- 配布物manifest・不要ファイル・権限監査: Pass
- `0.3.0`配布ZIP生成: Pass
- SHA-256生成: Pass

自動テストでは、ZIPの展開と内容一致、CRC検証、逐次fetch、Cookieなし、redirect拒否、宣言値と実読込値の容量上限、キャンセル、同名ファイル、offscreen lifecycle、Chrome download状態、任意権限解放、同一チャンネル内の候補累積、別チャンネル分離、popup再表示時の復元と明示クリアを確認しました。

## 依存関係監査

- runtime dependencyは`fflate 0.8.3`のみ
- npm registryのメタデータでMITライセンスと公式repositoryを確認
- GitHub Advisory DatabaseとNVDで`fflate`に一致する既知advisoryがないことを検索確認
- `pnpm audit --prod`はnpm旧audit endpoint廃止によるHTTP 410で実行不能

HTTP 410は脆弱性検出結果ではありません。pnpmまたは監査手段を更新し、bulk advisory endpointに対応した機械監査を別途整備します。

## 未完了のリリースゲート

- Chrome Stableでの25 / 50 / 100 MiBのpeak memory・所要時間・キャンセル応答計測
- 権利が明確な実Discord添付を使ったZIP保存・展開
- Chrome実機での権限解放、offscreen終了、popup close/reopen確認
- Project ownerによるADR-0003承認

手順は[Phase 5 メディアZIP手動テスト](../testing/zip-export-checklist.md)に従います。
