# ADR-0009: locale catalogと安定error codeで拡張UIを多言語化する

- Status: Accepted
- Date: 2026-07-17
- Decision owners: Project owner

## Context

popup、Discord上のガイド、domain、永続化stateに日本語文言が分散していました。このまま英語を追加すると、service worker再起動後の状態や収集中のガイドを現在の言語へ再描画できず、contextごとに翻訳とfallbackの挙動が異なります。

Chrome manifestのlocale機構だけを使う案、各contextが独立した文字列を持つ案、共通catalogと安定した論理状態を使う案を比較しました。

## Decision

- 対応localeを`ja`と`en`に限定し、英語をmanifestと未対応Chrome言語の既定値にする
- `locales/<locale>.yml`を翻訳文言とmanifest名称・説明のsource-of-truthにする
- 生成scriptが`src/shared/generated-i18n.ts`と`public/_locales/<locale>/messages.json`を出力し、生成物は直接編集しない
- popupとDiscord上のガイドは生成された共通TypeScript catalogとtranslatorを使う
- popupの上書きは`auto | ja | en`として`chrome.storage.local`へ保存し、同期や外部送信を行わない
- `auto`は`chrome.i18n.getUILanguage()`の日本語variantだけを日本語とし、それ以外は英語に解決する
- locale変更時は保持中の候補、選択、進捗、collector、ガイド状態を維持したまま再描画する
- 選択localeにkeyがなければ英語、英語にもなければ`[key]`を表示して警告する
- 生成時に日英catalogのkey集合、placeholder、値の型を検証し、生成物の差分もリリース前に検査する
- domainとcontext間stateは翻訳済み文言を持たず、`UserFacingErrorCode`とallowlist済みparamsを保持する
- 旧sessionの文字列errorは復元時に汎用codeへ移行し、旧localeの文言を再表示しない
- ファイル名とChrome中断理由は翻訳しない。Discordのaria-label判定語は各YAMLの`discord`辞書で管理し、Discord側の表示言語が拡張localeと異なる場合に備えて全localeの語を統合して判定する
- 表示には`textContent`と安全な属性APIだけを使う

manifestの名称・説明はChromeが解決するため、popup内の上書き対象に含めません。この制約を設定UIとREADMEで明示します。

## Consequences

### Positive

- Chrome言語追従と明示上書きを同じ解決規則で扱える
- popupを閉じたりcollectorを再生成したりせず、現在状態を別言語で再描画できる
- domainと永続化stateが表示言語から独立し、service worker再起動後も一貫する
- 未定義key、placeholder不足、未知code・paramsを自動テストで検出できる

### Negative

- 利用者向け文言の変更では日英catalogとplaceholderテストを同時に保守する必要がある
- YAMLのbuild-time parserをdevDependencyとして保守する必要がある。runtime bundleには含めない
- Chromeが描画するmanifest文言と拡張内UIでは、利用者の上書き選択が異なる場合がある
- 新しいerror codeを追加する際はvalidatorと両言語catalogの更新が必要になる

## Rejected alternatives

### `chrome.i18n.getMessage()`だけを全contextで使う

Chrome localeだけに固定され、popup内の上書きと収集中ガイドの即時切替を一貫して実装しにくいため採用しません。

### 翻訳済みerror文字列をstateへ保存する

復元後や言語変更後も以前の言語が残り、未知の動的文字列をcontext境界で検証できないため採用しません。

### 外部翻訳serviceまたは新しいi18n依存を追加する

対応言語が二つで、ローカルYAML catalogとbuild-time生成で要件を満たせます。通信先、アカウント・権限管理、翻訳PR運用を増やすため現時点では採用しません。言語数や外部翻訳者が増えた場合は再検討します。

## Revisit triggers

- 対応localeを三言語以上へ拡張する
- 外部の翻訳協力者が継続的に参加し、Crowdin等とのGit連携が必要になる
- plural ruleや日時・通貨等、現在のtranslatorを超えるformat要件が生じる
- Chromeのmanifest localeまたはstorage仕様が変わる
