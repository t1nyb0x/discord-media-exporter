import { defineUnlistedScript } from 'wxt/utils/define-unlisted-script';
import { browser } from 'wxt/browser';
import {
  GuidedCollectionControls,
  revealVisibleSpoilers,
  scrollOnePageBackward,
  scrollOnePageForward,
} from '../src/extractors/discord/guided-scroll';
import type { CandidateCollection, ScanResult } from '../src/domain/media';
import { discordChannelScope } from '../src/domain/url';
import { isValidMediaCandidate } from '../src/domain/validation';
import { VisibleMediaCollector } from '../src/extractors/discord/visible-media-collector';
import { isCollectorRequest, type CollectorResponse } from '../src/shared/collector-messages';
import { isRecord } from '../src/shared/messages';
import {
  createTranslator,
  resolveLocale,
  type LocalePreference,
  type Translator,
} from '../src/shared/i18n';
import {
  chromeUiLanguage,
  loadResolvedLocale,
  LOCALE_PREFERENCE_KEY,
} from '../src/platform/chrome/locale-setting';

interface CollectorController {
  collector: VisibleMediaCollector | null;
  controls: GuidedCollectionControls | null;
  collectedCount: number;
  launcherScope: string | null;
  listenerRegistered: boolean;
  navigationListenerRegistered: boolean;
  launcherVisible: boolean;
  persistentLauncher: boolean;
  startPromise: Promise<CollectorResponse> | null;
  translator: Translator;
  localeListenerRegistered: boolean;
}

declare global {
  var __discordMediaExporterCollector__: CollectorController | undefined;
}

export default defineUnlistedScript({
  /** Injects an inactive launcher without scanning until the user starts collection. */
  main() {
    const controller = getCollectorController();
    const scope = discordChannelScope(window.location.href);
    if (scope === null) {
      removePageController(controller);
      return { active: false };
    }
    controller.launcherScope = scope;
    controller.launcherVisible = true;
    const controls = ensureControls(controller);
    if (controller.collector?.isActive()) {
      controls.showActive(controller.collectedCount);
    } else if (controller.startPromise === null) {
      controls.showInactive();
    }
    void restorePersistentLauncherMode(controller);
    void restoreLocale(controller);
    return { active: controller.collector?.isActive() ?? false };
  },
});

/** Returns the page-global collector controller and registers its message listener once. */
function getCollectorController(): CollectorController {
  globalThis.__discordMediaExporterCollector__ ??= {
    collector: null,
    controls: null,
    collectedCount: 0,
    launcherScope: null,
    listenerRegistered: false,
    navigationListenerRegistered: false,
    launcherVisible: false,
    persistentLauncher: false,
    startPromise: null,
    translator: createTranslator(resolveLocale('auto', chromeUiLanguage())),
    localeListenerRegistered: false,
  };
  const controller = globalThis.__discordMediaExporterCollector__;
  if (controller.controls === undefined) controller.controls = null;
  if (controller.collectedCount === undefined) controller.collectedCount = 0;
  if (controller.launcherScope === undefined) controller.launcherScope = null;
  if (controller.navigationListenerRegistered === undefined) {
    controller.navigationListenerRegistered = false;
  }
  if (controller.launcherVisible === undefined) controller.launcherVisible = false;
  if (controller.persistentLauncher === undefined) controller.persistentLauncher = false;
  if (controller.startPromise === undefined) controller.startPromise = null;
  if (controller.translator === undefined)
    controller.translator = createTranslator(resolveLocale('auto', chromeUiLanguage()));
  if (controller.localeListenerRegistered === undefined)
    controller.localeListenerRegistered = false;
  if (!controller.localeListenerRegistered) {
    try {
      browser.storage.onChanged.addListener((changes, areaName) => {
        if (areaName !== 'local' || changes[LOCALE_PREFERENCE_KEY] === undefined) return;
        const next = changes[LOCALE_PREFERENCE_KEY].newValue;
        const preference: LocalePreference = next === 'ja' || next === 'en' ? next : 'auto';
        controller.translator = createTranslator(resolveLocale(preference, chromeUiLanguage()));
        controller.controls?.setTranslator(controller.translator);
      });
    } catch {
      // Older test/browser environments may not expose storage change events.
    }
    controller.localeListenerRegistered = true;
  }
  if (!controller.listenerRegistered) {
    browser.runtime.onMessage.addListener((message): Promise<CollectorResponse> | undefined => {
      if (!isCollectorRequest(message)) return undefined;
      if (message.type === 'START_MEDIA_COLLECTOR') {
        return startCollector(controller);
      }
      if (message.type === 'SET_MEDIA_COLLECTOR_COUNT') {
        controller.collectedCount = message.count;
        if (controller.collector?.isActive()) {
          controller.controls?.setCollectedCount(message.count);
        }
      }
      if (message.type === 'STOP_MEDIA_COLLECTOR') {
        controller.collector?.stop();
        controller.collector = null;
        showInactiveOrRemove(controller);
      }
      if (message.type === 'REMOVE_MEDIA_COLLECTOR_LAUNCHER') {
        controller.launcherVisible = false;
        controller.persistentLauncher = false;
        if (!controller.collector?.isActive()) {
          controller.controls?.remove();
          controller.controls = null;
          controller.launcherScope = null;
        }
      }
      return Promise.resolve(statusResponse(controller));
    });
    controller.listenerRegistered = true;
  }
  if (!controller.navigationListenerRegistered) {
    window.navigation?.addEventListener('navigate', (event) => {
      const destination = (event as NavigateEvent).destination;
      handlePageNavigation(controller, destination.url);
    });
    controller.navigationListenerRegistered = true;
  }
  return controller;
}

/** Starts one page-scoped collector and registers its initial visible candidates. */
function startCollector(controller: CollectorController): Promise<CollectorResponse> {
  if (controller.collector?.isActive()) return Promise.resolve(statusResponse(controller));
  if (controller.startPromise !== null) return controller.startPromise;

  const startPromise = startCollectorOnce(controller).finally(() => {
    if (controller.startPromise === startPromise) controller.startPromise = null;
  });
  controller.startPromise = startPromise;
  return startPromise;
}

/** Performs the guarded collector start and returns a safe result envelope. */
async function startCollectorOnce(controller: CollectorController): Promise<CollectorResponse> {
  let startedScope: string | null = null;
  const collector = new VisibleMediaCollector(
    document,
    window,
    async (result) => {
      const collection = await registerScanResult(result);
      controller.collectedCount = collection.candidates.length;
      controller.controls?.setCollectedCount(controller.collectedCount);
    },
    undefined,
    () => {
      if (controller.collector === collector) controller.collector = null;
      if (discordChannelScope(window.location.href) === startedScope) {
        showInactiveOrRemove(controller);
      } else {
        controller.controls?.remove();
        controller.controls = null;
      }
    },
  );
  const result = collector.start();
  if (!result.ok) {
    return { type: 'MEDIA_COLLECTOR_START_FAILED', active: false, error: { code: result.code } };
  }

  startedScope = result.scope;
  controller.collector = collector;
  try {
    const collection = await registerScanResult(result);
    if (controller.collector !== collector || !collector.isActive()) {
      return {
        type: 'MEDIA_COLLECTOR_START_FAILED',
        active: false,
        error: { code: 'COLLECTOR_START_INTERRUPTED' },
      };
    }
    controller.collectedCount = collection.candidates.length;
    controller.controls?.showActive(controller.collectedCount);
    return {
      type: 'MEDIA_COLLECTOR_STARTED',
      active: true,
      collection,
      visibleCandidateCount: result.candidates.length,
    };
  } catch {
    collector.stop();
    return {
      type: 'MEDIA_COLLECTOR_START_FAILED',
      active: false,
      error: { code: 'COLLECTION_REGISTER_FAILED' },
    };
  }
}

/** Registers one successful page scan and validates the background collection response. */
async function registerScanResult(
  result: Extract<ScanResult, { ok: true }>,
): Promise<CandidateCollection> {
  const response: unknown = await browser.runtime.sendMessage({
    type: 'REGISTER_SCAN_RESULT',
    scope: result.scope,
    candidates: result.candidates,
  });
  if (
    !isRecord(response) ||
    response.ok !== true ||
    response.type !== 'SCAN_REGISTERED' ||
    !isCandidateCollection(response.collection) ||
    response.collection.scope !== result.scope
  ) {
    throw new Error('Collection registration failed');
  }
  return response.collection;
}

/** Creates or returns the page controls shared by inactive and active states. */
function ensureControls(controller: CollectorController): GuidedCollectionControls {
  if (controller.controls !== null) return controller.controls;

  const controls = new GuidedCollectionControls(
    document,
    {
      onStart: async () => {
        const response = await startCollector(controller);
        if (response.type === 'MEDIA_COLLECTOR_STARTED') {
          return { ok: true, collectedCount: response.collection.candidates.length };
        }
        if (response.type === 'MEDIA_COLLECTOR_STATUS' && response.active) {
          return { ok: true, collectedCount: controller.collectedCount };
        }
        return {
          ok: false,
          error:
            response.type === 'MEDIA_COLLECTOR_START_FAILED'
              ? response.error
              : { code: 'COLLECTOR_START_FAILED' },
        };
      },
      onStepBackward: () => scrollOnePageBackward(document, window),
      onStepForward: () => scrollOnePageForward(document, window),
      onRevealSpoilers: () => revealVisibleSpoilers(document, window),
      onStop: () => {
        controller.collector?.stop();
        controller.collector = null;
        showInactiveOrRemove(controller);
      },
    },
    controller.translator,
  );
  controller.controls = controls;
  return controls;
}

/** Applies the persisted locale without replacing controls or collector state. */
async function restoreLocale(controller: CollectorController): Promise<void> {
  const { locale } = await loadResolvedLocale();
  controller.translator = createTranslator(locale);
  controller.controls?.setTranslator(controller.translator);
}

/** Returns the current collector activity without exposing page data. */
function statusResponse(controller: CollectorController): CollectorResponse {
  return {
    type: 'MEDIA_COLLECTOR_STATUS',
    active: controller.collector?.isActive() ?? false,
  };
}

/** Stops collection and removes page UI when navigation leaves the injected channel scope. */
function removePageController(controller: CollectorController): void {
  controller.launcherScope = null;
  controller.launcherVisible = false;
  controller.collector?.stop();
  controller.collector = null;
  controller.controls?.remove();
  controller.controls = null;
  controller.collectedCount = 0;
}

/** Restores whether optional Discord access should keep the launcher across SPA navigation. */
async function restorePersistentLauncherMode(controller: CollectorController): Promise<void> {
  try {
    const response: unknown = await browser.runtime.sendMessage({
      type: 'GET_DISCORD_LAUNCHER_SETTING',
    });
    controller.persistentLauncher =
      isRecord(response) &&
      response.ok === true &&
      response.type === 'DISCORD_LAUNCHER_SETTING' &&
      response.enabled === true;
  } catch {
    controller.persistentLauncher = false;
  }
}

/** Updates or removes the launcher when Discord changes routes without reloading the document. */
function handlePageNavigation(controller: CollectorController, destinationUrl: string): void {
  const destinationScope = discordChannelScope(destinationUrl);
  if (destinationScope === controller.launcherScope) return;

  controller.collector?.stop();
  controller.collector = null;
  controller.collectedCount = 0;

  if (controller.persistentLauncher && destinationScope !== null) {
    controller.launcherScope = destinationScope;
    controller.launcherVisible = true;
    ensureControls(controller).showInactive();
    return;
  }
  removePageController(controller);
}

/** Returns to the inactive launcher only while the current injection mode still permits it. */
function showInactiveOrRemove(controller: CollectorController): void {
  if (controller.launcherVisible) {
    controller.controls?.showInactive();
    return;
  }
  controller.controls?.remove();
  controller.controls = null;
  controller.launcherScope = null;
}

/** Validates a background candidate collection before using its count or candidates. */
function isCandidateCollection(value: unknown): value is CandidateCollection {
  return (
    isRecord(value) &&
    (value.scope === null ||
      (typeof value.scope === 'string' && discordChannelScope(value.scope) === value.scope)) &&
    Array.isArray(value.candidates) &&
    value.candidates.every(isValidMediaCandidate)
  );
}
