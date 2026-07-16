# インストール・更新ガイド

この拡張機能は Chrome Web Store では公開せず、信頼できる利用者へビルド済みファイルを限定配布します。インストールには Chrome の Developer mode を使います。

> [!WARNING]
> Developer mode では Chrome Web Store の審査を受けていないコードを実行できます。配布元を確認し、意図しないファイルが含まれている場合はインストールしないでください。

## 対応環境

- デスクトップ版 Google Chrome
- 通常プロファイル
- 配布時に明記された最小 Chrome バージョン以上

ゲストモード、モバイル版 Chrome は対象外です。組織管理端末では、管理者ポリシーにより Developer mode や拡張機能の読み込みが禁止されている場合があります。

## 受け取るもの

- バージョン付きの配布 ZIP
- ZIP の SHA-256
- リリースノート

配布 ZIP には、ビルド済みの `manifest.json`、JavaScript、HTML、CSS、アイコンだけを含めます。秘密鍵、ソースマップ、テストデータ、開発用設定は含めません。

## インストール

1. 信頼できる配布元から ZIP と SHA-256 を受け取る。
2. ZIP の SHA-256 が配布元の値と一致することを確認する。
3. ZIP を、更新時にも残しておける専用ディレクトリへ展開する。
4. Chrome で `chrome://extensions` を開く。
5. 右上の **Developer mode** を有効にする。
6. **Load unpacked** を押す。
7. `manifest.json` が直下にある展開済みディレクトリを選択する。
8. 表示された拡張機能名、バージョン、権限をリリースノートと照合する。
9. 拡張機能をツールバーへ固定する。

読み込み元ディレクトリを移動・削除すると、再読み込みできなくなります。インストール後もそのディレクトリを保持してください。

## SHA-256 の確認例

配布ファイル名を `discord-media-exporter-0.4.1-chrome.zip` とした例です。

### Windows PowerShell

```powershell
Get-FileHash .\discord-media-exporter-0.4.1-chrome.zip -Algorithm SHA256
```

### macOS

```bash
shasum -a 256 discord-media-exporter-0.4.1-chrome.zip
```

### Linux

```bash
sha256sum discord-media-exporter-0.4.1-chrome.zip
```

ハッシュが一致しない場合は、展開もインストールもせず配布元へ連絡してください。

開発者は次のコマンドで、全検証、配布ZIP、SHA-256ファイルを生成します。

```bash
pnpm release:prepare
```

生成物:

- `.output/discord-media-exporter-0.4.1-chrome.zip`
- `.output/discord-media-exporter-0.4.1-chrome.zip.sha256`

`main`へ反映された版はGitHub Actionsでも同じ検証と生成を行い、`v<version>` GitHub Releaseへこの2ファイルを添付します。利用者へ渡す前に、Releaseのタグとファイル名が対象バージョンに一致し、workflowが成功していることを確認します。

## 更新

自動更新はありません。

1. 新しい ZIP、SHA-256、リリースノートを受け取る。
2. SHA-256 を確認する。
3. ZIP を旧バージョンとは別のディレクトリへ展開する。
4. `chrome://extensions` で旧バージョンの **Remove** を押す。
5. **Load unpacked** から新しいディレクトリを選ぶ。
6. バージョン、権限、基本動作を確認する。
7. 問題がなければ旧ディレクトリを削除する。

この方法では拡張機能 ID がビルド間で変わる可能性があり、ローカル設定が引き継がれない場合があります。安定した ID と設定移行が必要になった時点で、公開鍵の管理方法を別途設計します。秘密鍵を配布 ZIP に含めてはいけません。

## 一時的に無効化する

1. `chrome://extensions` を開く。
2. 対象拡張機能のトグルをオフにする。

無効化中は Discord ページへアクセスせず、ダウンロードも開始しません。

## アンインストール

1. `chrome://extensions` を開く。
2. 対象拡張機能の **Remove** を押す。
3. 不要になった展開済みディレクトリと配布 ZIP を削除する。
4. 拡張機能が作成したダウンロード済みファイルは、必要に応じて別途削除する。

## トラブルシューティング

### 「Manifest file is missing or unreadable」と表示される

ZIP 自体や一つ上のディレクトリを選択している可能性があります。`manifest.json` が直下にある展開済みディレクトリを選んでください。

### Chrome の再起動後に動かない

`chrome://extensions` でエラーを確認し、読み込み元ディレクトリが移動・削除されていないことを確認してから **Reload** を押します。

### Developer mode を有効にできない

組織管理端末のポリシーで禁止されている可能性があります。ポリシーを回避せず、端末管理者へ確認してください。

### 更新後に権限が増えている

更新を中止し、リリースノートと配布元を確認してください。本プロジェクトが使用する基本権限は`activeTab`、`scripting`、`downloads`、`storage`、`offscreen`です。メディアZIP利用時だけDiscord CDN 2ホストへの任意権限を要求し、処理後に解放します。恒久的な必須host permissionは使用しません。

## 参考資料

- [Chrome Extensions: Distribute your extension](https://developer.chrome.com/docs/extensions/how-to/distribute)
- [Chrome Enterprise: Load an unpacked extension](https://support.google.com/chrome/a/answer/2714278)
