# Phase 2 検証記録

- Date: 2026-07-15
- Branch: `agent/phase2-hardening`
- Status: Hardening 実装済み。手動回帰テストと依存関係監査は未完了

## 変更内容

- ダウンロードキューをブラウザ API から分離し、状態遷移を単体テスト可能にした
- 最大 3 件の同時実行と、完了後の次候補開始をテストした
- 一件の開始失敗・中断が後続候補を止めないことをテストした
- service worker 再起動後に `chrome.downloads.search()` で実状態を再照合するようにした
- popup にファイル単位の待機・保存中・完了・失敗とエラー理由を表示した
- 4 件の代表 fixture、対象外ページ、500 件の性能上限をテストした

## 受け入れ条件

| 条件                                    | 状態 | 根拠                                       |
| --------------------------------------- | ---- | ------------------------------------------ |
| 画像 2、動画 1、その他 1 を重複なく検出 | Pass | DOM fixture テスト                         |
| 選択した項目だけを保存                  | Pass | 2026-07-15 の基本スモークテスト            |
| 同一添付の重複排除                      | Pass | CDN/Media proxy の identity テスト         |
| 危険なファイル名の無害化                | Pass | パストラバーサル・予約名・長さの単体テスト |
| 対象外ページでは DOM を走査しない       | Pass | `NOT_DISCORD_CHANNEL` テスト               |
| 認証情報を取得・記録しない              | Pass | manifest と静的検索。該当 API・ログなし    |
| 一件の開始失敗・中断後も他候補を処理    | Pass | DownloadManager 単体テスト                 |
| 権限・プライバシー・手動更新説明        | Pass | README と `docs/`                          |

## 自動検証

- `pnpm lint`: Pass
- `pnpm typecheck`: Pass
- `pnpm test`: Pass（7 files / 23 tests）
- `pnpm build`: Pass
- `pnpm format:check`: Pass
- 生成 manifest: `activeTab`, `scripting`, `downloads`, `storage` のみ
- 恒久的 host permission / 常駐 content script: なし

## セキュリティレビュー

- [x] `<all_urls>`, `cookies`, `webRequest`, `history` を要求していない
- [x] `eval`, `new Function`, リモートコードを使用していない
- [x] URL の scheme、hostname、attachment path を検証している
- [x] 候補 ID と URL identity を service worker 側で再照合している
- [x] ファイル名サニタイズに単体テストがある
- [x] 実装コードで `innerHTML` を使用していない
- [x] 完全な URL や個人情報をログへ出していない
- [x] 一括保存前に権利上の注意を表示している
- [x] fixture に架空 ID と無効な署名値だけを使用している
- [ ] 依存関係の脆弱性監査

依存関係監査は、`pnpm audit` が npm の旧 Audit endpoint 廃止により HTTP 410、GitHub Dependabot API はリポジトリで alerts が無効なため HTTP 403 となり、完了できていません。Dependabot を有効化するか、別の監査手段を決める必要があります。

## 残作業

1. `.output/chrome-mv3` を Reload して、詳細進捗表示を実 Discord で回帰確認する
2. 4 件以上を選び、同時実行・完了後のキュー継続を確認する
3. 可能ならネットワーク切断または失効 URL で、失敗理由と他候補の継続を確認する
4. Dependabot または代替の依存関係監査を有効にする
5. 実ブラウザ E2E の実行環境を用意する。現在の開発環境には Chrome/Chromium バイナリがない
