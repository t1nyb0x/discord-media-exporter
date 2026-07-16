# Discord Media Exporter 0.5.1 リリースノート

## 概要

Phase 6の大容量ZIPについて、実機で巨大ファイルを生成しなくても検証できるZIP64境界テストと、OPFS・Chrome adapterの失敗経路テストを追加しました。

## 追加した自動検証

- 4 GiB直前・超過のentry sizeをZIP64 extra fieldへ正確に保持
- 4 GiB超のlocal header offset、central directory offset、ZIP64 locator
- 65,535件と65,536件のZIP64 entry count
- 101件をfetch、ZIP64 writer、OPFS adapter、`File`、ZIP展開まで処理
- OPFS孤児一時ファイルのcleanup失敗件数返却と次回起動相当の再試行
- `chrome.downloads`の`FILE_NO_SPACE`を保存先容量不足として表示
- service worker再起動後も`FILE_NO_SPACE`状態を復元
- `navigator.storage.estimate()`による推定空き容量表示

## 実機確認との境界

ZIP64 record、件数、OPFS adapter、Chrome APIの状態遷移は自動検証できます。一方、次の端末依存項目は自動テストだけでは保証しません。

- Chromeプロセス全体の実メモリ使用量
- 物理ディスクを実際に満杯にした場合の挙動
- 4 GiB超ファイルを実際に保存する際の所要時間と安定性
- Windows、macOS、Linux標準展開機能の互換性

これらはリリースを妨げない既知の実機検証項目として継続します。
