# Phase 7: ガイド付き一画面収集

実装状況: GSC-01からGSC-15とGSC-19からGSC-27は実装済みです。GSC-16からGSC-18はIssue #19で追加します。任意常時表示のChrome Stable実機確認はIssue #22のリリースゲートとして残します。

## 1. 目的

ユーザーがDiscordを手動で何度も大きくスクロールする負担を減らしつつ、無人の履歴巡回を行わない収集操作を提供します。

## 2. 操作

1. ツールバーアイコンからpopupを開く。
2. Discord画面右下に停止状態の「ガイド付き収集」を表示する。
3. popupまたはDiscord画面内で「自動収集を開始」を押す。
4. active状態のガイドでユーザーが「1画面戻る」を押す。
5. メッセージ領域を古い投稿の方向へ表示高の80%だけ移動する。
6. 既存collectorがscroll・DOM変更を検知し、表示された添付だけを候補へ追加する。
7. 必要な範囲まで、ユーザーが操作を繰り返す。
8. スポイラー付き添付がある場合は、必要な画面で「表示中のスポイラーを解除」を押す。
9. ガイドまたはpopupから停止する。ページ内ガイドはinactive launcherへ戻る。

「Discordで開始ボタンを常に表示」をONにしてDiscordサイト権限を許可した場合は、手順1を省略し、Discordチャンネルを開いた時点でinactive launcherを表示できます。常時表示中も、開始buttonを押すまでscanとDOM監視は開始しません。

順序を重視して収集する場合は、次の任意フローを利用します。

1. 「1画面戻る」を一回ずつ押し、ユーザーが開始地点を選ぶ。
2. popupの「収集をクリア」で、そのチャンネルの既存候補を明示的に削除する。
3. 「1画面進む」を一回ずつ押し、新しく表示された候補を追加する。

拡張機能は最上部まで自動移動せず、収集結果も自動クリアしません。開始地点がチャンネル履歴の最古投稿であることや、メッセージ単位の完全な添付順は保証しません。

## 3. 機能要件

| ID     | 要件                                                                             | 優先度 |
| ------ | -------------------------------------------------------------------------------- | ------ |
| GSC-01 | popupの明示操作後にinactive launcherを表示し、開始後だけactive操作を表示する     | Must   |
| GSC-02 | 一回の明示clickにつき一回だけ、古い投稿方向へ一画面未満移動する                  | Must   |
| GSC-03 | timer・再帰・連続loopで追加scrollを行わない                                      | Must   |
| GSC-04 | scroll後も現在の可視範囲だけを既存collectorで収集する                            | Must   |
| GSC-05 | scroll containerを確認できない場合は移動せずエラー状態を表示する                 | Must   |
| GSC-06 | 上端で自動再試行せず、ユーザーの次操作を待つ                                     | Must   |
| GSC-07 | 停止・チャンネル変更・reload・タブ終了でガイドとcollectorを終了する              | Must   |
| GSC-08 | 500件到達時は移動操作を無効化する                                                | Must   |
| GSC-09 | ガイドをShadow DOMへ隔離し、`innerHTML`や外部scriptを使用しない                  | Must   |
| GSC-10 | 内部API、token、Cookie、必須host permission、`<all_urls>`を使用しない            | Must   |
| GSC-11 | 明示操作時だけ、表示範囲内のスポイラー操作要素を一回列挙する                     | Must   |
| GSC-12 | aria-labelの`spoiler`・`スポイラー`・`ネタバレ`で確認した可視要素だけをclickする | Must   |
| GSC-13 | 一回最大50件とし、画面外・disabled・不明要素を操作しない                         | Must   |
| GSC-14 | 自動反復、scroll後の自動解除、設定永続化を行わない                               | Must   |
| GSC-15 | 500件到達時はスポイラー解除操作も無効化する                                      | Must   |
| GSC-16 | 一回の明示clickにつき一回だけ、新しい投稿方向へ一画面未満移動する                | Must   |
| GSC-17 | 下端で自動再試行せず、ユーザーの次操作を待つ                                     | Must   |
| GSC-18 | 順序優先収集でも開始地点への自動移動と収集結果の自動クリアを行わない             | Must   |
| GSC-19 | popupを開いた明示操作後だけinactive launcherをページへ注入する                   | Must   |
| GSC-20 | inactive launcherでは開始clickまでscan、DOM監視、候補登録を行わない              | Must   |
| GSC-21 | popupとページ内開始操作を同じguard付きcontrollerへ接続する                       | Must   |
| GSC-22 | 停止後はactive操作を隠し、再開可能なinactive launcherへ戻る                      | Must   |
| GSC-23 | 常時表示をONにする明示clickからDiscordの任意host permissionを要求する            | Must   |
| GSC-24 | 許可中だけDiscordチャンネルへinactive launcherを動的に自動注入する               | Must   |
| GSC-25 | 自動注入後も開始clickまでscan、MutationObserver、scroll・resize監視を行わない    | Must   |
| GSC-26 | 常時表示OFF・権限取消時にscript登録とDiscordサイト権限を解除する                 | Must   |
| GSC-27 | 権限拒否・未許可時もpopup経由の`activeTab` launcherを利用できる                  | Must   |

## 4. 安全境界

- 収集対象はメッセージ表示領域と交差したDiscord添付だけ
- 保存前の候補確認・選択を維持
- 同じチャンネル内だけで候補を累積
- 無人の連続scroll、定期巡回、複数チャンネル横断を行わない
- 順序優先収集はユーザーが選んだ開始地点からのbest-effortとする
- 既存候補のクリアはpopupの明示操作だけで行う
- 常時表示OFFのinactive launcherはpopupを開いた明示操作後だけ注入し、開始前にメディアDOMを走査しない
- 常時表示は任意権限を許可した利用者だけに適用し、OFF時は`activeTab`方式へ戻る
- スポイラーはユーザーが解除buttonを押した表示範囲だけを対象にする
- ガイド操作が規約上のscrapingに当たらないという公式保証はない

## 5. テスト

### 自動

- scrollableなメッセージ領域と祖先containerを特定できる
- 一回の関数呼び出しで表示高の80%だけ移動する
- 一回のbutton clickでscroll処理が一回だけ呼ばれる
- 上端、下端、container不明、500件到達で追加移動しない
- 上方向と下方向のbuttonが対応する方向へ一回だけ移動する
- 順序優先フローが自動移動・自動クリア経路を持たない
- launcher注入直後はcollector、MutationObserver、scroll・resize監視が開始されていない
- popupとページ内の開始操作を競合させてもcollector startが一回だけ呼ばれる
- 停止後にページ内UIがinactive launcherへ戻る
- 任意権限の許可・拒否・取消とdynamic content scriptの登録状態を同期する
- 常時表示OFF後に新しいDiscordチャンネルへlauncherを自動注入しない
- 停止とチャンネル変更でガイドを削除する
- 既存の手動scroll収集、候補重複排除、ZIP・個別保存が回帰しない
- aria-labelで確認した可視スポイラーだけを最大50件clickする
- 画面外・通常button・500件到達時にスポイラーを解除しない

### Chrome Stable

- 実Discordでガイドがメッセージ操作を妨げない
- 一回の操作で一画面だけ古い方向へ移動する
- 一回の操作で一画面だけ新しい方向へ移動する
- 任意の開始地点で明示クリア後、下方向へ候補を追加できる
- Discordが古い投稿を追加描画した後も次操作で継続できる
- 停止、別チャンネル移動、reloadでガイドが残らない
- 500件到達時に移動buttonが無効になる
- 表示中のスポイラーが解除され、解除後の画像が収集される

## 6. 完了条件

- GSC-01からGSC-27を満たす
- 無人の連続scroll経路が存在しない
- 任意のDiscordサイト権限以外に、新しいpermissionと外部通信を追加しない
- Project ownerが実Discordで移動方向、移動量、停止を確認する
- [ADR-0006](adr/0006-guide-one-scroll-step-per-user-action.md)の境界を維持する
- [ADR-0007](adr/0007-reveal-visible-spoilers-on-explicit-action.md)の解除境界を維持する
- [ADR-0008](adr/0008-opt-in-discord-launcher-permission.md)の任意権限境界を維持する

## 7. 実機確認

2026-07-16にProject ownerがガイド付き収集を実機で確認しました。Chromeバージョン、OS、個別測定値は共有されていないため推測で補完しません。確認中に見つかったZIP内順序と`.txt`出力はPhase 6側の出力回帰として修正し、修正後の再確認対象とします。
