import { afterEach, describe, expect, it, vi } from 'vitest';

const scope = 'https://discord.com/channels/100/200';

const browserMocks = vi.hoisted(() => ({
  addListener: vi.fn(),
  sendMessage: vi.fn(),
}));

const collectorMocks = vi.hoisted(() => ({
  start: vi.fn(),
  stop: vi.fn(),
}));

vi.mock('wxt/browser', () => ({
  browser: {
    runtime: {
      onMessage: { addListener: browserMocks.addListener },
      sendMessage: browserMocks.sendMessage,
    },
  },
}));

vi.mock('wxt/utils/define-unlisted-script', () => ({
  defineUnlistedScript: <T>(definition: T): T => definition,
}));

vi.mock('../../src/extractors/discord/visible-media-collector', () => ({
  VisibleMediaCollector: class {
    private active = false;

    start() {
      collectorMocks.start();
      this.active = true;
      return { ok: true, scope, candidates: [] };
    }

    stop() {
      collectorMocks.stop();
      this.active = false;
    }

    isActive() {
      return this.active;
    }

    getScope() {
      return scope;
    }

    scanCurrent() {
      return { ok: true, scope, candidates: [] };
    }
  },
}));

describe('scan entrypoint collector status', () => {
  const originalNavigation = window.navigation;

  afterEach(() => {
    Object.defineProperty(window, 'navigation', {
      configurable: true,
      value: originalNavigation,
    });
    globalThis.__discordMediaExporterCollector__ = undefined;
    vi.resetModules();
    vi.resetAllMocks();
  });

  it('returns collector status through a Promise for Chrome runtime messaging', async () => {
    window.location.href = scope;
    let navigateListener: ((event: unknown) => void) | undefined;
    Object.defineProperty(window, 'navigation', {
      configurable: true,
      value: {
        addEventListener: vi.fn((_type: string, listener: (event: unknown) => void) => {
          navigateListener = listener;
        }),
      },
    });
    browserMocks.sendMessage.mockImplementation(async (request: { type: string }) =>
      request.type === 'GET_DISCORD_LAUNCHER_SETTING'
        ? { ok: true, type: 'DISCORD_LAUNCHER_SETTING', enabled: false }
        : {
            ok: true,
            type: 'SCAN_REGISTERED',
            collection: { scope, candidates: [] },
          },
    );
    const definition = (await import('../../entrypoints/scan')).default as {
      main(): unknown;
    };
    definition.main();
    expect(collectorMocks.start).not.toHaveBeenCalled();
    expect(document.getElementById('discord-media-exporter-guided-controls')).not.toBeNull();
    const host = document.getElementById('discord-media-exporter-guided-controls')!;
    const startButton = [...host.shadowRoot!.querySelectorAll<HTMLButtonElement>('button')].find(
      (button) => button.textContent === '自動収集を開始',
    )!;
    expect(startButton.hidden).toBe(false);

    const listener = browserMocks.addListener.mock.calls[0]?.[0] as
      ((message: unknown) => unknown) | undefined;
    expect(listener).toBeTypeOf('function');

    const statusResponse = listener!({ type: 'GET_MEDIA_COLLECTOR_STATUS' });
    expect(statusResponse).toBeInstanceOf(Promise);
    await expect(statusResponse).resolves.toEqual({
      type: 'MEDIA_COLLECTOR_STATUS',
      active: false,
    });

    const startResponse = listener!({ type: 'START_MEDIA_COLLECTOR' });
    expect(startResponse).toBeInstanceOf(Promise);
    await expect(startResponse).resolves.toEqual({
      type: 'MEDIA_COLLECTOR_STARTED',
      active: true,
      collection: { scope, candidates: [] },
      visibleCandidateCount: 0,
    });
    expect(collectorMocks.start).toHaveBeenCalledOnce();
    expect(browserMocks.sendMessage).toHaveBeenCalledWith({
      type: 'REGISTER_SCAN_RESULT',
      scope,
      candidates: [],
    });

    await expect(listener!({ type: 'START_MEDIA_COLLECTOR' })).resolves.toEqual({
      type: 'MEDIA_COLLECTOR_STATUS',
      active: true,
    });
    expect(collectorMocks.start).toHaveBeenCalledOnce();

    await expect(listener!({ type: 'SET_MEDIA_COLLECTOR_COUNT', count: 500 })).resolves.toEqual({
      type: 'MEDIA_COLLECTOR_STATUS',
      active: true,
    });
    const stepButton = [...host.shadowRoot!.querySelectorAll<HTMLButtonElement>('button')].find(
      (button) => button.textContent === '1画面戻る',
    )!;
    expect(stepButton.disabled).toBe(true);

    const stopResponse = listener!({ type: 'STOP_MEDIA_COLLECTOR' });
    expect(stopResponse).toBeInstanceOf(Promise);
    await expect(stopResponse).resolves.toEqual({
      type: 'MEDIA_COLLECTOR_STATUS',
      active: false,
    });
    expect(document.getElementById('discord-media-exporter-guided-controls')).not.toBeNull();
    expect(startButton.hidden).toBe(false);

    await expect(listener!({ type: 'REMOVE_MEDIA_COLLECTOR_LAUNCHER' })).resolves.toEqual({
      type: 'MEDIA_COLLECTOR_STATUS',
      active: false,
    });
    expect(document.getElementById('discord-media-exporter-guided-controls')).toBeNull();

    definition.main();
    expect(document.getElementById('discord-media-exporter-guided-controls')).not.toBeNull();

    navigateListener?.({
      destination: { url: 'https://discord.com/channels/100/300' },
    });
    expect(document.getElementById('discord-media-exporter-guided-controls')).toBeNull();
  });

  it('keeps the inactive launcher across Discord SPA channel navigation when opt-in is enabled', async () => {
    window.location.href = scope;
    let navigateListener: ((event: unknown) => void) | undefined;
    Object.defineProperty(window, 'navigation', {
      configurable: true,
      value: {
        addEventListener: vi.fn((_type: string, listener: (event: unknown) => void) => {
          navigateListener = listener;
        }),
      },
    });
    browserMocks.sendMessage.mockResolvedValue({
      ok: true,
      type: 'DISCORD_LAUNCHER_SETTING',
      enabled: true,
    });
    const definition = (await import('../../entrypoints/scan')).default as {
      main(): unknown;
    };

    definition.main();
    await Promise.resolve();
    await Promise.resolve();
    navigateListener?.({
      destination: { url: 'https://discord.com/channels/100/300' },
    });

    expect(document.getElementById('discord-media-exporter-guided-controls')).not.toBeNull();
    const startButton = [
      ...document
        .getElementById('discord-media-exporter-guided-controls')!
        .shadowRoot!.querySelectorAll<HTMLButtonElement>('button'),
    ].find((button) => button.textContent === '自動収集を開始');
    expect(startButton?.hidden).toBe(false);
    expect(collectorMocks.start).not.toHaveBeenCalled();
  });
});
