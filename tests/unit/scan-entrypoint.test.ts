import { afterEach, describe, expect, it, vi } from 'vitest';

const scope = 'https://discord.com/channels/100/200';

const browserMocks = vi.hoisted(() => ({
  addListener: vi.fn(),
  sendMessage: vi.fn(),
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
      this.active = true;
      return { ok: true, scope, candidates: [] };
    }

    stop() {
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
  afterEach(() => {
    globalThis.__discordMediaExporterCollector__ = undefined;
    vi.resetModules();
    vi.resetAllMocks();
  });

  it('returns collector status through a Promise for Chrome runtime messaging', async () => {
    const definition = (await import('../../entrypoints/scan')).default as {
      main(): unknown;
    };
    definition.main();

    const listener = browserMocks.addListener.mock.calls[0]?.[0] as
      ((message: unknown) => unknown) | undefined;
    expect(listener).toBeTypeOf('function');

    const statusResponse = listener!({ type: 'GET_MEDIA_COLLECTOR_STATUS' });
    expect(statusResponse).toBeInstanceOf(Promise);
    await expect(statusResponse).resolves.toEqual({ active: true });

    const stopResponse = listener!({ type: 'STOP_MEDIA_COLLECTOR' });
    expect(stopResponse).toBeInstanceOf(Promise);
    await expect(stopResponse).resolves.toEqual({ active: false });
  });
});
