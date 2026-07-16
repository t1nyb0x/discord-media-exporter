# Phase 5 自動検証記録

- 実施日: 2026-07-15
- 対象バージョン: `0.3.0`
- 状態: Automated verification passed / Real-device media ZIP output confirmed

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

## 自動検証結果

- `pnpm lint`: Pass
- `pnpm typecheck`: Pass
- `pnpm test`: Pass（11 files / 37 tests）
- `pnpm format:check`: Pass
- `pnpm zip`: Pass
- 配布物manifest・不要ファイル・権限監査: Pass
- `0.3.0`配布ZIP生成: Pass
- SHA-256生成: Pass

自動テストでは、ZIPの展開と内容一致、CRC検証、逐次fetch、Cookieなし、redirect拒否、宣言値と実読込値の容量上限、キャンセル、同名ファイル、offscreen lifecycle、Chrome download状態、任意権限解放、popup操作を確認しました。

## 依存関係監査

- runtime dependencyは`fflate 0.8.3`のみ
- npm registryのメタデータでMITライセンスと公式repositoryを確認
- GitHub Advisory DatabaseとNVDで`fflate`に一致する既知advisoryがないことを検索確認
- `pnpm audit --prod`はnpm旧audit endpoint廃止によるHTTP 410で実行不能

HTTP 410は脆弱性検出結果ではありません。pnpmまたは監査手段を更新し、bulk advisory endpointに対応した機械監査を別途整備します。

## 実機確認

2026-07-16にProject ownerから、メディアZIP出力を実機で確認済みとの報告を受けました。Chromeバージョン、OS、25 / 50 / 100 MiBごとの測定値、個別チェック項目の結果は共有されていないため、本記録では推測して補完しません。

この確認と自動検証をもって、Phase 5のメディアZIP出力を完了扱いとし、ADR-0003をAcceptedとします。

## 後続フェーズ

自動収集機能は`0.4.0`の別変更として扱い、残る実機課題は[0.4.0自動検証・実機課題記録](0.4.0-automated-verification.md)で管理します。ZIP固定上限の撤廃はPhase 6として[全選択候補のディスクストリーミングZIP仕様](../large-zip-export.md)へ引き継ぎます。
