import { defineUnlistedScript } from 'wxt/utils/define-unlisted-script';
import { extractVisibleDiscordMedia } from '../src/extractors/discord/extract-visible-media';

export default defineUnlistedScript({
  main() {
    return extractVisibleDiscordMedia(document, window);
  },
});
