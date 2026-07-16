import { browser } from 'wxt/browser';
import { DISCORD_CHANNEL_MATCH, DISCORD_PAGE_ORIGIN } from '../../shared/permissions';

export const DISCORD_LAUNCHER_SCRIPT_ID = 'discord-media-exporter-launcher';

let registrationQueue: Promise<boolean> = Promise.resolve(false);

/** Returns whether the user currently grants optional Discord page access. */
export async function hasDiscordLauncherPermission(): Promise<boolean> {
  return browser.permissions.contains({ origins: [DISCORD_PAGE_ORIGIN] });
}

/** Reconciles the dynamic launcher registration with the current optional permission. */
export function reconcileDiscordLauncherRegistration(
  force = false,
  cleanupWhenDisabled = false,
): Promise<boolean> {
  registrationQueue = registrationQueue.then(
    () => reconcileDiscordLauncherRegistrationOnce(force, cleanupWhenDisabled),
    () => reconcileDiscordLauncherRegistrationOnce(force, cleanupWhenDisabled),
  );
  return registrationQueue;
}

/** Runs one serialized registration reconciliation. */
async function reconcileDiscordLauncherRegistrationOnce(
  force: boolean,
  cleanupWhenDisabled: boolean,
): Promise<boolean> {
  const enabled = await hasDiscordLauncherPermission();
  const registrations = await browser.scripting.getRegisteredContentScripts({
    ids: [DISCORD_LAUNCHER_SCRIPT_ID],
  });
  const registered = registrations.length > 0;

  if (!enabled) {
    if (registered) await unregisterDiscordLauncher();
    if (registered || cleanupWhenDisabled) await removeInactiveLaunchers();
    return false;
  }

  if (force && registered) await unregisterDiscordLauncher();
  if (force || !registered) {
    await browser.scripting.registerContentScripts([
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
  }
  return true;
}

/** Disables automatic launcher injection and releases the optional Discord permission. */
export function disableDiscordLauncher(): Promise<boolean> {
  registrationQueue = registrationQueue.then(
    disableDiscordLauncherOnce,
    disableDiscordLauncherOnce,
  );
  return registrationQueue;
}

/** Performs one serialized disable operation. */
async function disableDiscordLauncherOnce(): Promise<boolean> {
  await unregisterDiscordLauncher();
  await removeInactiveLaunchers();
  await browser.permissions.remove({ origins: [DISCORD_PAGE_ORIGIN] });
  return false;
}

/** Removes the registered script without failing when it is already absent. */
async function unregisterDiscordLauncher(): Promise<void> {
  await browser.scripting
    .unregisterContentScripts({ ids: [DISCORD_LAUNCHER_SCRIPT_ID] })
    .catch(() => undefined);
}

/** Removes inactive launchers from currently open Discord channel tabs before access is released. */
async function removeInactiveLaunchers(): Promise<void> {
  const tabs = await browser.tabs.query({}).catch(() => []);
  await Promise.all(
    tabs.map((tab) =>
      tab.id === undefined
        ? Promise.resolve()
        : browser.tabs
            .sendMessage(tab.id, { type: 'REMOVE_MEDIA_COLLECTOR_LAUNCHER' })
            .catch(() => undefined),
    ),
  );
}
