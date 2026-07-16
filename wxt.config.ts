import { defineConfig } from 'wxt';

export default defineConfig({
  manifest: {
    name: 'Discord Media Exporter',
    description: '表示中の Discord メディアを選択して保存します。',
    permissions: ['activeTab', 'scripting', 'downloads', 'storage', 'offscreen'],
    optional_host_permissions: ['https://cdn.discordapp.com/*', 'https://media.discordapp.net/*'],
    content_security_policy: {
      extension_pages:
        "script-src 'self'; object-src 'self'; img-src 'self' https://media.discordapp.net",
    },
    minimum_chrome_version: '120',
  },
});
