import { defineUnlistedScript } from 'wxt/utils/define-unlisted-script';
import { browser } from 'wxt/browser';
import { VisibleMediaCollector } from '../src/extractors/discord/visible-media-collector';
import { isCollectorRequest, type CollectorResponse } from '../src/shared/collector-messages';

interface CollectorController {
  collector: VisibleMediaCollector | null;
  listenerRegistered: boolean;
}

declare global {
  var __discordMediaExporterCollector__: CollectorController | undefined;
}

export default defineUnlistedScript({
  main() {
    const controller = getCollectorController();
    if (controller.collector?.isActive()) {
      const current = controller.collector.scanCurrent();
      if (current.ok && current.scope === controller.collector.getScope()) return current;
      controller.collector.stop();
      controller.collector = null;
    }

    const collector = new VisibleMediaCollector(document, window, async (result) => {
      const response: unknown = await browser.runtime.sendMessage({
        type: 'REGISTER_SCAN_RESULT',
        scope: result.scope,
        candidates: result.candidates,
      });
      if (
        typeof response !== 'object' ||
        response === null ||
        !('ok' in response) ||
        response.ok !== true
      ) {
        throw new Error('収集結果を登録できませんでした。');
      }
    });
    const result = collector.start();
    if (result.ok) controller.collector = collector;
    return result;
  },
});

function getCollectorController(): CollectorController {
  globalThis.__discordMediaExporterCollector__ ??= { collector: null, listenerRegistered: false };
  const controller = globalThis.__discordMediaExporterCollector__;
  if (!controller.listenerRegistered) {
    browser.runtime.onMessage.addListener((message): Promise<CollectorResponse> | undefined => {
      if (!isCollectorRequest(message)) return undefined;
      if (message.type === 'STOP_MEDIA_COLLECTOR') {
        controller.collector?.stop();
        controller.collector = null;
      }
      return Promise.resolve({ active: controller.collector?.isActive() ?? false });
    });
    controller.listenerRegistered = true;
  }
  return controller;
}
