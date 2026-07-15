# Phase 3 リリース判定記録

- Date: 2026-07-15
- Branch: `agent/phase3-limited-distribution`
- Version: `0.2.0`
- Status: Complete。Project owner による Chrome 実機確認で問題なし

## 配布物

- ZIP: `.output/discord-media-exporter-0.2.0-chrome.zip`
- SHA-256: `c799e4066aee4f31c2e6dc729a6c8c43a28ff3ffea69363573b7580494e5cdbd`
- Checksum file: `.output/discord-media-exporter-0.2.0-chrome.zip.sha256`

`sha256sum -c` でチェックサムが一致することを確認しました。ZIP には拡張機能の実行ファイルだけが含まれ、テスト、fixture、source map、秘密鍵、TypeScript ソースは含まれていません。

## 自動検証

- `pnpm lint`: Pass
- `pnpm typecheck`: Pass
- `pnpm test`: Pass（7 files / 24 tests）
- `pnpm format:check`: Pass
- `pnpm zip`: Pass
- `pnpm release:verify`: Pass
- manifest version と `package.json` version: 一致
- 権限: `activeTab`, `downloads`, `scripting`, `storage` のみ
- 恒久的 host permission / 常駐 content script: なし

## Phase 3 で追加した確認

- 非表示の添付を候補に含めない
- Discord のメッセージ領域を意味的な role から安全に限定できる
- 対応するメッセージ領域がない場合は広範囲を走査しない
- popup の言語、入力ラベル、ボタン名、進捗 live region を検証する
- 500 件を超える候補を処理しない
- 配布 ZIP の構成、権限、バージョン、不要ファイル不在を機械検証する

## 限定配布の判定

配布候補の生成と静的・自動検証に加え、Project owner が Chrome 実機で確認し、2026-07-15 に問題なしと判断しました。Phase 3 を完了し、[ADR-0002](../adr/0002-continue-limited-unpacked-distribution.md)に基づく限定保守へ移行します。

## 未完了の外部確認

1. スポイラー付き添付など、未確認の画面バリエーション
2. Dependabot または代替手段による依存関係の脆弱性監査
3. Chrome/Chromium を備えた環境での実ブラウザ E2E

現在の開発環境には Chrome/Chromium バイナリがありません。また、`pnpm audit` は npm の廃止済み Audit endpoint に対して HTTP 410 となるため、依存関係監査は別の手段が必要です。
