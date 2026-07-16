import type { ScanResult } from '../../domain/media';
import { extractVisibleDiscordMedia } from './extract-visible-media';

const DEFAULT_DEBOUNCE_MS = 250;

type SuccessfulScanResult = Extract<ScanResult, { ok: true }>;

/** Observes user-visible DOM changes and publishes changed scan results. */
export class VisibleMediaCollector {
  private observer: MutationObserver | null = null;
  private timer: number | undefined;
  private lastFingerprint = '';
  private active = false;
  private scope: string | null = null;

  constructor(
    private readonly documentObject: Document,
    private readonly windowObject: Window,
    private readonly publish: (result: SuccessfulScanResult) => void | Promise<void>,
    private readonly debounceMs = DEFAULT_DEBOUNCE_MS,
    private readonly onStopped?: () => void,
  ) {}

  /** Performs the initial scan and starts observation when scanning is supported. */
  start(): ScanResult {
    const result = this.scanCurrent();
    if (!result.ok || this.active) return result;

    this.active = true;
    this.scope = result.scope;
    this.lastFingerprint = fingerprint(result);
    this.documentObject.addEventListener('scroll', this.scheduleScan, true);
    this.windowObject.addEventListener('resize', this.scheduleScan);
    this.windowObject.addEventListener('popstate', this.scheduleScan);
    const observer = new MutationObserver(this.scheduleScan);
    observer.observe(this.documentObject.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['src', 'href', 'style', 'class', 'hidden'],
    });
    this.observer = observer;
    return result;
  }

  /** Stops observation, clears pending work, and notifies the owner once. */
  stop(): void {
    const wasActive = this.active;
    this.active = false;
    this.scope = null;
    this.documentObject.removeEventListener('scroll', this.scheduleScan, true);
    this.windowObject.removeEventListener('resize', this.scheduleScan);
    this.windowObject.removeEventListener('popstate', this.scheduleScan);
    this.observer?.disconnect();
    this.observer = null;
    if (this.timer !== undefined) this.windowObject.clearTimeout(this.timer);
    this.timer = undefined;
    if (wasActive) this.onStopped?.();
  }

  /** Reports whether this collector is currently observing the page. */
  isActive(): boolean {
    return this.active;
  }

  /** Returns the Discord channel scope captured when collection started. */
  getScope(): string | null {
    return this.scope;
  }

  /** Scans the current visible Discord message viewport. */
  scanCurrent(): ScanResult {
    return extractVisibleDiscordMedia(this.documentObject, this.windowObject);
  }

  /** Debounces scan work triggered by DOM, scroll, resize, or history changes. */
  private readonly scheduleScan = (): void => {
    if (!this.active) return;
    if (this.timer !== undefined) this.windowObject.clearTimeout(this.timer);
    this.timer = this.windowObject.setTimeout(() => {
      this.timer = undefined;
      void this.scanAndPublish().catch(() => undefined);
    }, this.debounceMs);
  };

  /** Publishes a changed result or stops when the channel scope changes. */
  private async scanAndPublish(): Promise<void> {
    if (!this.active) return;
    const result = this.scanCurrent();
    if (!result.ok) return;
    if (result.scope !== this.scope) {
      this.stop();
      return;
    }

    const nextFingerprint = fingerprint(result);
    if (nextFingerprint === this.lastFingerprint) return;
    await this.publish(result);
    this.lastFingerprint = nextFingerprint;
  }
}

/** Creates an order-independent fingerprint of a successful scan result. */
function fingerprint(result: SuccessfulScanResult): string {
  return result.candidates
    .map((candidate) => `${candidate.id}:${candidate.sourceUrl}`)
    .sort()
    .join('\n');
}
