# ロードマップ

日付ありの計画は、規約適合性の確認と担当者が決まった後に作成します。現時点では、成果物と終了条件でフェーズを管理します。

## 現在地

- Phase 0: ADR-0001 を Accepted とし、限定用途・配布方針を決定済み
- Phase 1: 基盤、合成 fixture、自動テスト、production build、実 Discord の基本スモークテストは完了
- Phase 1 残作業: スポイラー等の画面バリエーションの追加検証
- Phase 2: 候補単位の失敗表示、キュー異常系、再起動後の状態再照合を実装済み
- Phase 3: `0.2.0` の配布 ZIP、SHA-256、リリースノート、限定テスト手順、保守手順を作成済み
- Phase 3: 安全な DOM 非対応、非表示要素、アクセシビリティ、500 件の候補上限を自動テスト済み
- Phase 3: Project owner による Chrome 実機確認で問題がなく、完了
- Phase 4: 少人数への unpacked 配布継続を ADR-0002 で決定し、限定保守へ移行
- Phase 5: `0.3.0`メディアZIP出力を実装・自動検証・実機確認し、ADR-0003をAcceptedとして完了
- `0.4.1` follow-up: 自動収集ボタン状態復元を修正し、自動・実機回帰を完了
- Phase 6: store方式ZIP64 writer、OPFS逐次出力、固定上限撤廃、quota表示、cleanupを`0.5.0`へ実装し、自動検証を完了
- Phase 6 follow-up: `0.5.1`で4 GiB・65,536 entry・101件OPFS pipeline・容量不足・cleanup再試行を自動検証
- Phase 6 残作業: Chrome Stableでの101件・500件・1 GiB・4 GiB境界、quota・disk不足、OS展開互換性の実測と既知入力サイズ概算のfollow-up
- Phase 7: ユーザー操作ごとに一画面だけ遡るガイド付き収集を`0.6.0`へ実装し、ADR-0006をAccepted
- Phase 7: Project ownerがガイド付き収集を実機確認済み。ZIP取得順と`.zip`出力の修正後回帰を残す
- Phase 7 follow-up: 明示操作による表示中スポイラー解除とADR-0007を実装
- 継続課題: 未確認の画面バリエーション、依存関係監査、実ブラウザ E2E

## Phase 0: Discovery / Policy gate

成果物:

- 要件、技術設計、セキュリティ方針
- 「表示中メディアの保存支援」に限定した用途・操作・データフロー
- unpacked extension の限定配布と手動更新方針
- 権利が明確なテストサーバーとテストメディア

終了条件:

- Discord の利用規約を確認し、限定用途での利用判断と責任主体が明確になっている
- MVP の対象が「現在のメッセージ表示領域内」に合意されている
- 限定配布とデータ取り扱い方針が決まっている

## Phase 1: Technical spike

成果物:

- WXT/Manifest V3 の最小拡張
- `activeTab` + `scripting` で Discord の対象 DOM を読めるかの検証
- 画像、動画、添付の匿名化 fixture
- `chrome.downloads` で期限付き URL を保存できるかの手動検証
- 必要権限の確定

終了条件:

- 非公開 API、Cookie、トークンなしで代表ケースを扱える
- 恒久的 host permission の要否が説明できる
- 技術的に成立しなければ中止または公式 Bot API 案へ切り替える

## Phase 2: MVP

成果物:

- ユーザー操作による現在の可視範囲スキャン
- 候補一覧、絞り込み、選択
- 安全なファイル名と一括ダウンロード
- 候補単位の進捗・失敗表示
- 単体、統合、E2E テスト
- 日本語 UI と権限・権利上の注意

終了条件:

- [受け入れ条件](product-requirements.md#8-受け入れ条件)を満たす
- [セキュリティレビュー](security-and-privacy.md#7-セキュリティレビュー・チェックリスト)を完了する
- テストサーバーで手動スモークテストを完了する

## Phase 3: Limited distribution

成果物:

- 少人数の同意済みテスターによる評価
- DOM 変更時の失敗パターンと匿名化 fixture
- アクセシビリティと大規模候補数の改善
- 同梱するデータ取り扱い説明、インストール・更新・削除手順
- 配布物のハッシュとバージョン通知方法

終了条件:

- 重大な誤取得、情報漏えい、権限不足がない
- DOM 非対応時に安全に停止する
- 保守担当と更新方針が決まっている

配布候補と自動検証の結果は[Phase 3 リリース判定記録](reviews/phase3-release-readiness.md)を参照してください。

## Phase 4: Maintenance decision

決定:

- [ADR-0002](adr/0002-continue-limited-unpacked-distribution.md)に基づき、少人数への unpacked 配布を継続する
- Project owner が全利用者へ直接更新・停止連絡できる範囲に限定する
- 最新版だけをサポートし、固定周期を設けず必要時に更新する
- Chrome Web Store 公開、自己ホスト CRX、自動更新、遠隔測定は行わない

終了条件と再検討条件は[保守・更新方針](maintenance.md)に従います。これ以降は独立した開発フェーズではなく、利用者報告、DOM 変更、依存関係更新、規約・仕様変更を起点とした保守サイクルで管理します。

## Phase 5: Media ZIP export

目的:

- 現在表示中かつユーザーが選択したメディアを、一つの ZIP としてローカル保存できるようにする
- 既存の個別保存、スキャン範囲、規約・プライバシー上の境界を維持する

成果物:

- [メディア ZIP 出力仕様](zip-export.md)を満たす UI、background、offscreen ZIP worker
- CDN への任意ホスト権限と `offscreen` permission の説明
- 件数・バイト数上限、キャンセル、全体失敗、状態復元
- ZIP 内容、CRC、ファイル名衝突、権限拒否、ネットワーク異常の自動テスト
- 実機でのメディアZIP出力確認記録
- [ADR-0003](adr/0003-generate-media-zip-locally.md)の承認記録

実装順:

1. ZIP writer と offscreen document の技術 spike、メモリ計測
2. ZIP ドメインモデル、上限、ファイル名一意化、状態遷移
3. 任意ホスト権限、逐次取得、redirect 再検証
4. popup の保存形式選択、進捗、キャンセル、エラー表示
5. 自動テスト、Chrome 実機テスト、セキュリティ・配布物レビュー

終了条件:

- ZIP-01 から ZIP-12 と ZIP の受け入れ条件を満たす
- 不完全な ZIP、上限超過、許可外通信、完全な URL のログ出力がない
- Project ownerがChrome実機でメディアZIP出力を確認する
- 追加権限と依存関係を承認し、ADR-0003をAcceptedにする
- 限定配布向けのリリースノート、配布 ZIP、SHA-256、手動確認記録を作成する

自動検証とProject ownerによる実機確認の記録は[Phase 5 自動検証記録](reviews/phase5-automated-verification.md)を参照してください。手動確認項目の詳細は[メディアZIP手動テスト](testing/zip-export-checklist.md)に残しています。

## 0.4.0 / 0.4.1 follow-up: Automatic visible-media collection

目的:

- popupで一度開始した後、同じチャンネルの手動スクロール中に表示された候補を自動累積する
- popup close/reopen、明示停止、チャンネル変更時停止、500件上限を扱う

状態:

- 実装と自動検証は完了
- `0.4.0`で、収集継続中でもpopup再表示時にボタンがOFF表示になる問題を確認
- runtime message responseをPromiseで返す修正を`0.4.1`へ実装
- 自動回帰テストとProject ownerによる実機回帰はPass
- `0.4.1`でfollow-upを完了

問題の記録は[0.4.0自動収集機能の検証記録](reviews/0.4.0-automated-verification.md)、修正リリースの結果は[0.4.1リリース検証記録](reviews/0.4.1-release-verification.md)を参照してください。

## Phase 6: Disk-streamed full-selection ZIP

目的:

- ZIP固有の100件・50 MiB・100 MiB固定上限を廃止し、選択した候補を全件処理する
- archive全体をJavaScript heapへ保持せず、大容量処理でもChromeを安定させる
- 「固定上限なし」と「物理的に無制限」を区別し、quota・disk不足を安全に扱う

設計判断:

- 入力responseをCache Storageへ保存する方式は、入力合計と完成ZIPの二重領域・追加I/Oが必要になるため採用しない
- ZIP64 writerの出力をOPFS一時ファイルへ直接streaming writeする
- 候補registryの500件上限は維持し、その範囲の全選択を一つのZIPで扱う
- 初期実装では`unlimitedStorage`permissionを追加しない

成果物:

- [Phase 6 全選択候補のディスクストリーミングZIP仕様](large-zip-export.md)
- [ADR-0005](adr/0005-stream-large-zip-to-opfs.md)に基づく技術spikeと実装検証
- ZIP64 writer、OPFS adapter、backpressure、quota表示、cleanup
- 101件・500件・1 GiB・4 GiB超・quota不足・disk不足の自動／手動検証記録

実装状況:

- [x] store方式ZIP64 streaming writer
- [x] OPFS一時ファイルへの逐次write、close、getFile、削除
- [x] writerからOPFSへのbackpressure
- [x] ZIP固有の100件・50 MiB・100 MiB固定上限撤廃
- [x] 最大500候補の全件処理、quota参考表示、入力・出力バイト進捗
- [x] quota、write、キャンセル、孤児一時ファイルcleanupの自動テスト
- [x] synthetic 4 GiB、65,535／65,536 entry、101件OPFS pipelineの自動境界テスト
- [x] 保存先容量不足とcleanup再試行のChrome adapter自動テスト
- [ ] 追加requestなしで取得可能な既知入力サイズ概算の設計
- [ ] Chrome Stableでの大容量・容量不足・OS展開互換性の手動検証

実装順:

1. [x] OPFSへのchunk write、`getFile()`、Blob URL、`chrome.downloads`への接続
2. [x] store方式ZIP64 streaming writerの実装
3. [x] domain状態・エラー、quota見積り、OPFS lifecycleとcleanup
4. [x] 現行100件・50 MiB・100 MiB上限の置き換えとpopup表示更新
5. [ ] Chrome Stable実測、4 GiB境界互換性、security・permissionレビュー

終了条件:

- LZIP-01からLZIP-13を満たす
- 101件と500件、4 GiB超を保存・展開できる
- heap使用量がarchiveサイズに比例せず、writer→OPFSの未書き込み量が有界である
- 全失敗・キャンセル・次回起動で一時ファイルと権限をcleanupする
- 新しいpermissionなしで成立するか、追加permissionを別ADRで承認する

## Phase 7: Guided one-page collection

目的:

- 手動スクロールの負担を減らしつつ、各移動をユーザーの明示操作に限定する
- 無人の履歴巡回、連続scroll、通常ユーザーアカウント自動化を避ける

成果物:

- [Phase 7 ガイド付き一画面収集仕様](guided-scroll-collection.md)
- [ADR-0006](adr/0006-guide-one-scroll-step-per-user-action.md)
- Shadow DOMのページ内ガイド、一画面移動、停止、500件上限
- 可視範囲・aria-label・最大50件に限定したスポイラー解除
- scroll container、移動回数、上端、停止、チャンネル変更の自動テスト

終了条件:

- GSC-01からGSC-10を満たす
- 一回のclickに対して一回だけscrollする
- timer・再帰・連続loopによる無人scroll経路がない
- 実Discordでガイド表示、古い方向への移動、停止を確認する
- ZIP内の取得順連番と`.zip`出力を実機で再確認する
- 実Discordで可視スポイラーだけが解除されることを確認する

## MVP 後の候補

- 投稿時刻やメディア種別によるローカル整理
- ダウンロード前のファイル名編集
- 失敗した項目だけの再試行
- 英語 UI
- 対応画面の追加

無人の連続自動スクロール、定期巡回、複数チャンネルの無人収集、ユーザートークン利用は将来候補に含めません。[ADR-0004](adr/0004-observe-visible-media-after-user-start.md)と[ADR-0006](adr/0006-guide-one-scroll-step-per-user-action.md)に基づき、ユーザー開始後の同一チャンネルと、明示操作ごとの一画面移動に限定します。さらなる自動化は規約・権限・プライバシーの再レビューを必要とします。
