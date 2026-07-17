import { defineConfig } from 'wxt';

export default defineConfig({
  manifest: {
    name: '__MSG_extension_name__',
    description: '__MSG_extension_description__',
    default_locale: 'en',
    permissions: ['activeTab', 'scripting', 'downloads', 'storage', 'offscreen'],
    optional_host_permissions: [
      'https://discord.com/*',
      'https://cdn.discordapp.com/*',
      'https://media.discordapp.net/*',
    ],
    content_security_policy: {
      extension_pages:
        "script-src 'self'; object-src 'self'; img-src 'self' https://media.discordapp.net",
    },
    minimum_chrome_version: '120',
  },
});
