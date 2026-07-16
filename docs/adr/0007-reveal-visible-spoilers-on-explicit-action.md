# ADR-0007: 明示操作時だけ表示中のスポイラーを解除する

- Status: Accepted
- Date: 2026-07-16
- Decision owners: Project owner

## Context

Discordのスポイラー付き添付は、解除前に内部画像が非表示となるDOM構造では、現在の可視性検証によって収集対象から除外されます。ユーザーが一件ずつDiscord上で解除すれば収集できますが、表示範囲に複数ある場合は操作負担が増えます。

スポイラーは投稿者が意図的に隠した内容です。拡張機能が画面外や履歴全体を自動解除すると、ユーザーが見る意思を示していない内容を表示・収集することになります。

## Decision

Phase 7のページ内ガイドへ「表示中のスポイラーを解除」を追加します。ユーザーがこのbuttonを押した場合だけ、現在のメッセージ表示領域と交差する、aria-labelでスポイラーと確認できる操作要素を一回だけclickします。

- デフォルトでは何も解除しない
- 一回のbutton clickに対して一回だけ可視要素を列挙する
- 対象は`button[aria-label]`または`[role="button"][aria-label]`
- aria-labelに`spoiler`、`スポイラー`、`ネタバレ`のいずれかを含む要素だけを対象にする
- `aria-expanded="true"`の解除済み要素は操作しない
- 画面外、非表示、disabled、別チャンネルの要素を対象にしない
- 一回の操作で最大50件までに制限する
- 解除後のDOM変更を既存collectorが検知し、表示状態になった添付だけを収集する
- 自動反復、scroll後の自動解除、設定の永続化を行わない
- 500件到達時は解除buttonも無効化する
- DiscordのDOM変更で対象を確認できない場合は解除しない

この方式がDiscord規約上の適用除外を受けることは確認できていません。

## Consequences

### Positive

- ユーザーが現在見る意思を示した範囲だけをまとめて解除できる
- URLや非表示mediaを直接迂回せず、Discord自身の表示操作を経由する
- 既存の可視性検証とcollectorを維持できる

### Negative

- Discordのaria-label、role、click handler変更で動作しなくなる
- scriptによる`.click()`をDiscordが受け付けない場合がある
- 一回の操作で複数の隠された内容が表示される
- 限定的でもDiscord UIの自動操作に当たる可能性がある

## Rejected alternatives

### scrollするたびに自動解除

各スポイラーを表示する明示意思が弱くなり、解除範囲も増えるため採用しません。

### URLだけをDOMから取得して表示せず保存

スポイラーの表示意図と「表示された候補だけ」という境界を迂回するため採用しません。

### class名に`spoiler`を含む全要素をclick

Discordのhashed classや内部装飾を誤操作する可能性があるため採用しません。

## Revisit triggers

- aria-labelだけでは代表的なスポイラーを特定できない
- 通常のDiscord操作を誤ってclickした
- 一回の解除件数が多すぎる、または意図しない表示が発生した
- Discord規約またはself-bot方針が変更された

## References

- [Discord Terms of Service](https://discord.com/terms)
- [Discord: Automated User Accounts (Self-Bots)](https://support.discord.com/hc/en-us/articles/115002192352-Automated-User-Accounts-Self-Bots)
