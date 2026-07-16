# ADR-0008: 任意のDiscordサイト権限で開始launcherを自動表示する

- Status: Accepted
- Date: 2026-07-17
- Decision owners: Project owner

## Context

現在の`activeTab`方式は、利用者がツールバーアイコン、popup、ショートカット等で拡張機能を明示的に起動した後だけ、対象タブへ一時アクセスしてpage scriptを注入できます。

この境界では、Discordチャンネルを開いた直後からページ内の「自動収集を開始」を表示できません。自動表示には、対象サイトでcontent scriptを自動実行できる継続的なhost accessが必要です。

必須host permissionや静的`content_scripts`を追加する案、任意host permissionを利用者が明示許可した後だけ動的content scriptを登録する案、現在の`activeTab`方式を維持する案を比較しました。

## Decision

Discordチャンネルで開始launcherを常時表示する機能はopt-inとし、任意host permissionと動的content scriptを使用します。

- `https://discord.com/*`を`optional_host_permissions`へ宣言する
- popupへ「Discordで開始ボタンを常に表示」の明示的なON/OFF操作を設ける
- ON操作のclick handlerから`chrome.permissions.request()`を呼び、拒否時は登録しない
- 許可後、`chrome.scripting.registerContentScripts()`で軽量launcherを登録する
- content scriptのmatchは`https://discord.com/channels/*`だけに限定する
- 登録scriptはisolated world、`document_idle`、top frameだけで実行する
- 登録はChromeセッションを跨いで維持し、起動・更新時に権限と登録状態を照合する
- OFF操作では動的content scriptを登録解除し、`https://discord.com/*`権限を解放する
- Chrome設定等から権限が外された場合も、次回起動時または権限変更eventで登録を解除する
- 任意権限を許可しない場合は、`activeTab`とpopupからのprogrammatic injectionを引き続き利用できる
- 自動注入するのはinactive launcherだけとし、開始buttonを押すまで候補scan、MutationObserver、scroll・resize監視、候補登録を行わない
- 自動収集の開始、scroll、スポイラー解除、保存は従来どおり個別の明示操作を必要とする
- 静的manifest `content_scripts`、必須Discord host permission、`<all_urls>`は追加しない

Discordサイト権限は、ZIP用CDN権限と異なり、常時表示をONにしている間は保持します。UIとリリースノートで、権限の用途、保持期間、解除方法を説明します。

## Consequences

### Positive

- 一度opt-inすれば、Discordチャンネルを開いた時点から開始launcherを表示できる
- インストール時の必須サイトアクセスを避け、必要な利用者だけが権限を許可できる
- 権限を許可しない利用者も従来の`activeTab`フローを利用できる
- launcher表示とメディア収集開始を分離し、ページ表示だけで候補を収集しない

### Negative

- 許可中は拡張機能がDiscordページでコードを実行できる継続的なsite accessを持つ
- 権限許可、拒否、Chrome設定からの取消、登録状態の不整合を扱う必要がある
- popupへ権限状態と解除操作を追加し、利用者向け説明を維持する必要がある
- dynamic content scriptの登録・解除と既存タブのlauncher cleanupをテストする必要がある

## Rejected alternatives

### 必須host permissionと静的content script

全利用者へDiscordサイトアクセスを必須にし、機能を利用しない場合も権限を保持するため採用しません。

### `activeTab`方式だけを維持

権限は最小ですが、Discordチャンネルを開いた時点からlauncherを表示する要件を満たさないため、opt-inを補完経路として追加します。

### launcher表示と同時に自動収集を開始

ページを開いただけでメディアDOMの走査と監視が始まり、収集開始を明示操作とする境界を失うため採用しません。

### `webNavigation` permissionでタブ遷移を監視して注入

別permissionとservice worker側の広いnavigation監視が増えます。対象ページへのdynamic content scriptで要件を満たせるため採用しません。

## Revisit triggers

- Chromeの任意host permissionまたはdynamic content scriptの仕様が変わった
- Discordページでlauncher以外の処理が開始前に動作していることが判明した
- 権限取消後もscript登録やlauncherが残る問題が発生した
- Discordの規約・仕様変更により常時launcher表示を継続できない

## References

- [Chrome Extensions: The activeTab permission](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab)
- [Chrome Extensions: chrome.scripting](https://developer.chrome.com/docs/extensions/reference/api/scripting)
- [Chrome Extensions: Declare permissions](https://developer.chrome.com/docs/extensions/develop/concepts/declare-permissions)
