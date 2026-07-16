import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DISCORD_CHANNEL_MATCH, DISCORD_PAGE_ORIGIN } from '../../src/shared/permissions';

const browserMocks = vi.hoisted(() => ({
  containsPermission: vi.fn(),
  removePermission: vi.fn(),
  getRegisteredContentScripts: vi.fn(),
  registerContentScripts: vi.fn(),
  unregisterContentScripts: vi.fn(),
  queryTabs: vi.fn(),
  sendTabMessage: vi.fn(),
}));

vi.mock('wxt/browser', () => ({
  browser: {
    permissions: {
      contains: browserMocks.containsPermission,
      remove: browserMocks.removePermission,
    },
    scripting: {
      getRegisteredContentScripts: browserMocks.getRegisteredContentScripts,
      registerContentScripts: browserMocks.registerContentScripts,
      unregisterContentScripts: browserMocks.unregisterContentScripts,
    },
    tabs: {
      query: browserMocks.queryTabs,
      sendMessage: browserMocks.sendTabMessage,
    },
  },
}));

describe('Discord launcher registration', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    browserMocks.getRegisteredContentScripts.mockResolvedValue([]);
    browserMocks.registerContentScripts.mockResolvedValue(undefined);
    browserMocks.unregisterContentScripts.mockResolvedValue(undefined);
    browserMocks.queryTabs.mockResolvedValue([]);
    browserMocks.sendTabMessage.mockResolvedValue(undefined);
    browserMocks.removePermission.mockResolvedValue(true);
  });

  afterEach(() => {
    vi.resetModules();
  });

  it('registers the inactive launcher only when optional Discord access is present', async () => {
    browserMocks.containsPermission.mockResolvedValue(true);
    const { reconcileDiscordLauncherRegistration, DISCORD_LAUNCHER_SCRIPT_ID } =
      await import('../../src/platform/chrome/discord-launcher-registration');

    await expect(reconcileDiscordLauncherRegistration()).resolves.toBe(true);

    expect(browserMocks.containsPermission).toHaveBeenCalledWith({
      origins: [DISCORD_PAGE_ORIGIN],
    });
    expect(browserMocks.registerContentScripts).toHaveBeenCalledWith([
      {
        id: DISCORD_LAUNCHER_SCRIPT_ID,
        matches: [DISCORD_CHANNEL_MATCH],
        js: ['scan.js'],
        allFrames: false,
        runAt: 'document_idle',
        world: 'ISOLATED',
        persistAcrossSessions: true,
      },
    ]);
  });

  it('does not duplicate an existing registration', async () => {
    browserMocks.containsPermission.mockResolvedValue(true);
    browserMocks.getRegisteredContentScripts.mockResolvedValue([
      { id: 'discord-media-exporter-launcher' },
    ]);
    const { reconcileDiscordLauncherRegistration } =
      await import('../../src/platform/chrome/discord-launcher-registration');

    await expect(reconcileDiscordLauncherRegistration()).resolves.toBe(true);

    expect(browserMocks.registerContentScripts).not.toHaveBeenCalled();
    expect(browserMocks.unregisterContentScripts).not.toHaveBeenCalled();
  });

  it('unregisters, cleans existing launchers, and releases permission when disabled', async () => {
    browserMocks.queryTabs.mockResolvedValue([{ id: 1 }, { id: 2 }, {}]);
    browserMocks.sendTabMessage.mockResolvedValue({
      type: 'MEDIA_COLLECTOR_STATUS',
      active: false,
    });
    const { disableDiscordLauncher, DISCORD_LAUNCHER_SCRIPT_ID } =
      await import('../../src/platform/chrome/discord-launcher-registration');

    await expect(disableDiscordLauncher()).resolves.toBe(false);

    expect(browserMocks.unregisterContentScripts).toHaveBeenCalledWith({
      ids: [DISCORD_LAUNCHER_SCRIPT_ID],
    });
    expect(browserMocks.queryTabs).toHaveBeenCalledWith({});
    expect(browserMocks.sendTabMessage).toHaveBeenCalledWith(1, {
      type: 'REMOVE_MEDIA_COLLECTOR_LAUNCHER',
    });
    expect(browserMocks.sendTabMessage).toHaveBeenCalledWith(2, {
      type: 'REMOVE_MEDIA_COLLECTOR_LAUNCHER',
    });
    expect(browserMocks.removePermission).toHaveBeenCalledWith({
      origins: [DISCORD_PAGE_ORIGIN],
    });
  });

  it('removes stale registration and launchers after permission is revoked externally', async () => {
    browserMocks.containsPermission.mockResolvedValue(false);
    browserMocks.getRegisteredContentScripts.mockResolvedValue([
      { id: 'discord-media-exporter-launcher' },
    ]);
    browserMocks.queryTabs.mockResolvedValue([{ id: 1 }]);
    const { reconcileDiscordLauncherRegistration, DISCORD_LAUNCHER_SCRIPT_ID } =
      await import('../../src/platform/chrome/discord-launcher-registration');

    await expect(reconcileDiscordLauncherRegistration(false, true)).resolves.toBe(false);

    expect(browserMocks.unregisterContentScripts).toHaveBeenCalledWith({
      ids: [DISCORD_LAUNCHER_SCRIPT_ID],
    });
    expect(browserMocks.sendTabMessage).toHaveBeenCalledWith(1, {
      type: 'REMOVE_MEDIA_COLLECTOR_LAUNCHER',
    });
    expect(browserMocks.removePermission).not.toHaveBeenCalled();
  });
});
