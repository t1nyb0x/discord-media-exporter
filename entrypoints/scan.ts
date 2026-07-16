import { defineUnlistedScript } from 'wxt/utils/define-unlisted-script';
import { browser } from 'wxt/browser';
import {
  GuidedCollectionControls,
  revealVisibleSpoilers,
  scrollOnePageBackward,
} from '../src/extractors/discord/guided-scroll';
import { VisibleMediaCollector } from '../src/extractors/discord/visible-media-collector';
import { isCollectorRequest, type CollectorResponse } from '../src/shared/collector-messages';
import { isRecord } from '../src/shared/messages';

interface CollectorController {
  collector: VisibleMediaCollector | null;
  controls: GuidedCollectionControls | null;
  listenerRegistered: boolean;
}

declare global {
  var __discordMediaExporterCollector__: CollectorController | undefined;
}

export default defineUnlistedScript({
  /** Starts or reuses the page-scoped visible-media collector. */
  main() {
    const controller = getCollectorController();
    if (controller.collector?.isActive()) {
      const current = controller.collector.scanCurrent();
      if (current.ok && current.scope === controller.collector.getScope()) {
        if (controller.controls === null) {
          controller.controls = createControls(controller, controller.collector);
          controller.controls.setCollectedCount(current.candidates.length);
        }
        return current;
      }
      controller.collector.stop();
      controller.collector = null;
    }

    let controls: GuidedCollectionControls | null = null;
    const collector = new VisibleMediaCollector(
      document,
      window,
      async (result) => {
        const response: unknown = await browser.runtime.sendMessage({
          type: 'REGISTER_SCAN_RESULT',
          scope: result.scope,
          candidates: result.candidates,
        });
        if (
          !isRecord(response) ||
          response.ok !== true ||
          response.type !== 'SCAN_REGISTERED' ||
          !isRecord(response.collection) ||
          !Array.isArray(response.collection.candidates)
        ) {
          throw new Error('収集結果を登録できませんでした。');
        }
        controls?.setCollectedCount(response.collection.candidates.length);
      },
      undefined,
      () => {
        controls?.remove();
        controls = null;
        controller.controls = null;
        if (controller.collector === collector) controller.collector = null;
      },
    );
    const result = collector.start();
    if (result.ok) {
      controller.collector = collector;
      controls = createControls(controller, collector);
      controls.setCollectedCount(result.candidates.length);
    }
    return result;
  },
});

/** Returns the page-global collector controller and registers its message listener once. */
function getCollectorController(): CollectorController {
  globalThis.__discordMediaExporterCollector__ ??= {
    collector: null,
    controls: null,
    listenerRegistered: false,
  };
  const controller = globalThis.__discordMediaExporterCollector__;
  if (controller.controls === undefined) controller.controls = null;
  if (!controller.listenerRegistered) {
    browser.runtime.onMessage.addListener((message): Promise<CollectorResponse> | undefined => {
      if (!isCollectorRequest(message)) return undefined;
      if (message.type === 'SET_MEDIA_COLLECTOR_COUNT') {
        controller.controls?.setCollectedCount(message.count);
      }
      if (message.type === 'STOP_MEDIA_COLLECTOR') {
        controller.collector?.stop();
        controller.collector = null;
        controller.controls?.remove();
        controller.controls = null;
      }
      return Promise.resolve({ active: controller.collector?.isActive() ?? false });
    });
    controller.listenerRegistered = true;
  }
  return controller;
}

/** Creates guided controls wired to the active page collector. */
function createControls(
  controller: CollectorController,
  collector: VisibleMediaCollector,
): GuidedCollectionControls {
  const controls = new GuidedCollectionControls(document, {
    onStep: () => scrollOnePageBackward(document, window),
    onRevealSpoilers: () => revealVisibleSpoilers(document, window),
    onStop: () => {
      collector.stop();
      if (controller.collector === collector) controller.collector = null;
    },
  });
  controller.controls = controls;
  return controls;
}
