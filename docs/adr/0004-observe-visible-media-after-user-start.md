# ADR-0004: ユーザー開始後の表示中メディア自動収集

> ユーザーの明示操作ごとに一画面だけ遡るPhase 7のガイド付き収集は[ADR-0006](0006-guide-one-scroll-step-per-user-action.md)で追加判断しました。無人の連続自動スクロールは引き続き採用しません。
>
> 任意のDiscordサイト権限によるinactive launcherの自動表示は[ADR-0008](0008-opt-in-discord-launcher-permission.md)を参照してください。

- Status: Accepted
- Date: 2026-07-15
- Amended: 2026-07-17
- Decision owners: Project owner

## Context

DiscordをスクロールするとChromeの拡張機能popupは閉じるため、表示範囲ごとにpopupを開いて確認操作を繰り返す必要がありました。候補はセッション中に累積できますが、操作回数が多く、手動スクロール中に画面へ現れた添付を取りこぼしやすい状態です。

[ADR-0001](0001-user-initiated-dom-export.md)は自動スクロール、巡回、監視を行わない方針を採用していました。本変更はそのうち「監視を行わない」を限定的に見直すため、新しい判断として記録します。

## Decision

ユーザーがpopupまたはページ内ガイドで「自動収集を開始」を一度実行した後、そのタブの同じDiscordチャンネルに限り、表示領域の変化を監視して可視メディア候補を自動的に追加します。

- 任意のDiscordサイト権限がない場合は、ツールバーアイコンからpopupを開いた明示操作後に、現在のDiscordチャンネルへinactive launcherを注入する
- ADR-0008のopt-inが有効な場合は、Discordチャンネルへinactive launcherを動的content scriptとして自動注入する
- inactive launcherの表示だけでは候補scan、DOM監視、候補登録を開始しない
- 開始にはpopupまたはページ内ガイドの開始ボタンを押す明示操作を必要とする
- popupとページ内ガイドは同じpage-scoped controllerのguard付きstart処理を使用し、collectorを重複起動しない
- 初回scan結果はpage-scoped controllerがservice workerへ登録し、popupが閉じた状態でも開始を完了できる
- 注入済みスクリプトがscroll、resize、DOM変更を検知し、250 msのdebounce後に可視範囲だけを再走査する
- Discordを自動スクロールしない
- 内部API、Gateway、ユーザートークン、Cookieを使わない
- 別チャンネルへの移動、ページの再読み込み、タブを閉じた時、またはユーザーの停止操作で監視を終了する
- 候補は同一チャンネル内で重複排除し、Chromeセッション中に最大500件まで保持する
- 保存は従来どおり、一覧からユーザーが明示選択した候補だけを対象とする
- 必須host permissionと静的manifest content scriptは追加しない
- launcher常時表示のopt-in時だけ、`https://discord.com/*`の任意host permissionと動的content scriptを使用する

定期巡回、新着の無人監視、複数チャンネルの横断収集、自動スクロールは引き続き採用しません。

## Consequences

### Positive

- スクロールのたびにpopupを開く必要がない
- ユーザーが実際に表示した範囲を連続的に収集できる
- `activeTab`による一時アクセスと既存のURL検証境界を維持できる
- popupを閉じた後もDiscord画面から明示的に収集を開始できる

### Negative

- 開始後はpopupが閉じていても、同じチャンネル内の表示変化を監視する
- DiscordのDOM更新頻度によって再走査回数が増える
- 限定的な方式でもDiscord規約上許可される保証はなく、配布前の再確認が必要になる
- 監視中であること、停止条件、保持期間をUIとプライバシー文書で明示する必要がある
- opt-inを有効にしない場合は、launcher表示前にpopupを開く必要がある
- opt-in中はDiscordサイト権限を解除するまで保持する必要がある

## Revisit triggers

- DiscordのDOM更新で過剰な再走査や誤検出が発生した
- Chromeの`activeTab`または注入スクリプトのライフサイクルが変わった
- Discordの利用規約、開発者ポリシー、または用途に関する回答が変わった
- 500件上限でも意図しない収集や性能問題が確認された
