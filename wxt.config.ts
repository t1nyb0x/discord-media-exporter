import { defineConfig } from 'wxt';

export default defineConfig({
  manifest: {
    name: 'Discord Media Exporter',
    description: '表示中の Discord メディアを選択して保存します。',
    permissions: ['activeTab', 'scripting', 'downloads', 'storage'],
    minimum_chrome_version: '120',
  },
});
