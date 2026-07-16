# 開発ガイド

## 1. 前提

このリポジトリには、WXT/Manifest V3 による初期 MVP 実装があります。自動テスト、production build、実際の Discord チャンネルを使った基本スモークテストが成功しています。

実装開始前に[コントリビューションガイド](contributing.md)と関連仕様を確認してください。

## 2. 開発環境

- Chrome 120 以上。手動確認には最新の Chrome Stable を使用
- Node.js 24。`.nvmrc` と `package.json#engines` で固定
- pnpm 9.7.0。`packageManager` で固定
- WXT 0.20.27 + TypeScript 6.0.3

依存関係は `pnpm-lock.yaml` で固定します。「latest」のまま CI やリリースを動かしません。

## 3. ディレクトリ構成

```text
.
├── entrypoints/
│   ├── background.ts
│   ├── scan.ts
│   └── popup/
│       ├── index.html
│       ├── main.ts
│       └── style.css
├── src/
│   ├── domain/
│   ├── extractors/discord/
│   ├── platform/chrome/
│   └── shared/
├── tests/
│   ├── fixtures/
│   ├── unit/
│   └── unit/
├── docs/
├── wxt.config.ts
└── package.json
```

## 4. 実装状況

1. [x] 最小 manifest と popup/scan/background をビルド
2. [x] URL・ファイル名・メッセージの検証関数
3. [x] 匿名化 DOM fixture と extractor
4. [x] popup の候補一覧、絞り込み、選択
5. [x] `chrome.downloads` adapter と最大 3 件のキュー
6. [x] 単体テスト、lint、typecheck、production build
7. [x] テストサーバーで基本フローの手動スモークテスト
8. [x] 候補単位の進捗・失敗表示とキュー異常系テスト
9. [x] service worker 再起動後の状態再照合
10. [x] hardening 版の手動回帰テスト
11. [x] unpacked 配布前の最終レビュー
12. [ ] Dependabot または代替手段による依存関係監査
13. [x] Phase 5 メディア ZIP の要件・技術設計・ADR-0003
14. [x] WXT offscreenと`fflate` streaming ZIP writerの技術spike
15. [x] ZIPドメイン、任意権限、UI、キャンセル、状態復元の実装
16. [x] ZIP内容、上限、redirect、権限、状態遷移の自動テスト
17. [x] Project ownerによる`0.3.0`メディアZIP出力の実機確認
18. [x] ADR-0003の承認とPhase 5完了判定
19. [x] `0.4.1`自動収集ボタン状態修正の実機回帰確認
20. [x] Phase 6の全選択ZIP要件、OPFS設計、Accepted ADR-0005
21. [x] OPFS、Blob URL、downloadsを接続する逐次出力実装
22. [x] store方式ZIP64 writer選定、ZIP64 record・CRC・backpressureの自動テスト
23. [x] 固定上限の置き換え、quota表示、cleanup実装
24. [x] 500件を固定上限なしで処理する自動テスト
25. [ ] 101件・500件・1 GiB・4 GiB超のChrome Stable実測
26. [ ] quota・保存先disk不足とOS標準展開機能の手動検証
27. [x] synthetic 4 GiB、65,535／65,536 entry、101件OPFS pipelineの自動境界検証
28. [x] cleanup再試行、`FILE_NO_SPACE`、quota参考表示の自動テスト
29. [x] Phase 7ガイド付き一画面収集の仕様とAccepted ADR-0006
30. [x] ページ内ガイド、scroll container検出、一操作一移動、停止の実装
31. [x] 上端・container不明・500件・チャンネル変更の自動テスト
32. [x] Project ownerによるガイド付き収集の実機確認
33. [x] ZIP候補の取得順解決、連番、`application/zip` MIME修正と自動テスト
34. [ ] 修正後のZIP内順序と`.zip`出力を実機で再確認
35. [x] 明示操作による表示中スポイラー解除とAccepted ADR-0007
36. [x] 可視範囲・aria-label・最大50件・通常button除外の自動テスト
37. [x] 実Discordでスポイラー解除と解除後収集を確認

## 5. ローカル確認手順

```bash
pnpm install --frozen-lockfile
pnpm dev
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

unpacked extension の読み込み:

1. `chrome://extensions` を開く
2. Developer mode を有効にする
3. Load unpacked を選ぶ
4. `.output/chrome-mv3` を指定する
5. 権限警告が設計書と一致することを確認する

利用者にも同じ手順で、ビルド済みフォルダだけを指定してもらいます。ソースツリー全体や秘密情報を含むディレクトリは配布しません。更新時は配布元の SHA-256 を確認してファイルを差し替え、`chrome://extensions` で **Reload** します。

Windows と macOS の一般ユーザーへ、自前サーバー上の `.crx` を通常のリンクから直接インストールさせる方式は使えません。自己ホスト CRX は Linux または enterprise policy で管理された環境向けです。本プロジェクトでは自動更新を提供せず、バージョン通知と差し替えを手動運用にします。

## 6. fixture の作り方

実在チャンネルの HTML をそのままコミットしません。

1. 権利が明確なテストサーバーで代表ケースを表示する。
2. 必要な DOM 構造だけを最小 HTML として手で再構成する。
3. ユーザー名、本文、チャンネル名、server ID、channel ID、message ID を架空値にする。
4. URL validator のテストでは、架空の ID を使った `https://cdn.discordapp.com/attachments/...` に置き換え、実際の署名クエリを残さない。
5. avatar、絵文字、アクセシビリティ文言にも個人情報がないことを確認する。
6. 正常系、欠損属性、重複、悪意あるファイル名、未対応 DOM の fixture を分ける。

DOM セレクターを更新する変更には、必ず再現 fixture とテストを含めます。

## 7. 手動スモークテスト

### 実施記録

- 実施日: 2026-07-15
- 結果: 基本フロー成功
- 確認範囲: unpacked extension の読み込み、実 Discord での候補検出、選択、ダウンロード
- 未確認: スポイラー等の画面バリエーション、期限切れ URL、ネットワーク異常、DOM 変更時

規約上のゲートを通過した後、専用テストサーバーで次を確認します。

- 画像、動画、その他添付が正しく分類される
- 埋め込みリンクのプレビューを添付と誤認しない
- スポイラー付き添付、長い名前、日本語名を扱える
- 同一添付のサムネイルとリンクを重複表示しない
- 表示されていない過去メッセージへ勝手に移動しない
- 保存前に全対象を確認できる
- popup を閉じても開始済みダウンロードが壊れない
- 403/404/ネットワーク切断時に他の処理が継続する

テストでダウンロードしたファイルは、権利と保持方針に従って処分します。

Phase 2 の詳細な自動検証結果と残作業は[検証記録](reviews/phase2-verification.md)を参照してください。

## 8. Definition of Done

変更は次を満たした時に完了とします。

- 要件 ID または不具合への対応関係が説明されている
- lint、typecheck、単体テスト、production build が成功している
- 新しい DOM 分岐には匿名化 fixture がある
- 権限の追加・変更がない、または理由と UI 説明が更新されている
- ログに URL、メッセージ、個人情報が含まれない
- キーボードだけで主要操作ができる
- Chrome で手動確認されている
- 関連ドキュメントと変更履歴が更新されている
- ZIP の変更では[Phase 6 ZIP仕様](large-zip-export.md)の原子性、権限、容量不足処理、性能計測を満たしている

## 9. リリース前チェック

- `package.json` のバージョンを未公開の SemVer へ更新
- clean install から全検査を実行
- 生成 manifest と権限をレビュー
- source map、fixture、開発設定が unpacked 配布物に混入していないことを確認
- リモートコードや未承認通信がないことを確認
- README のデータ取り扱い説明と実装を照合
- Discord 利用規約を再確認
- 配布 ZIP の SHA-256 を記録
- インストール、更新、無効化、削除の手順を同梱
- テスト用と本番用の設定・アイコンを取り違えていないことを確認
- ロールバック可能な直前リリース成果物を保持

`main`へ反映されると[Release workflow](../.github/workflows/release.yml)が`pnpm release:prepare`を再実行し、`v<version>` GitHub Releaseを作成して配布 ZIPとSHA-256を添付します。同名のReleaseまたはタグは上書きしません。workflowの成功と添付ファイルを確認するまで利用者へ案内しないでください。
