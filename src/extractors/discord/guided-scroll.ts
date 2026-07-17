import { findMessageScrollContainer, findMessageViewport } from './message-viewport';
import { intersectRects, isElementVisibleInRect, type RectLike } from './visibility';
import type { UserFacingError } from '../../domain/errors';
import {
  createTranslator,
  type TranslationKey,
  type TranslationParams,
  type Translator,
} from '../../shared/i18n';
import { discordSpoilerLabelTerms } from '../../shared/generated-i18n';

const SCROLL_RATIO = 0.8;
const COLLECTION_LIMIT = 500;
const MAX_VISIBLE_SPOILERS_PER_ACTION = 50;
const CONTROL_HOST_ID = 'discord-media-exporter-guided-controls';

export type GuidedScrollStepResult =
  { status: 'moved'; reachedStart: boolean } | { status: 'at_start' } | { status: 'unavailable' };

export type GuidedScrollForwardResult =
  { status: 'moved'; reachedEnd: boolean } | { status: 'at_end' } | { status: 'unavailable' };

interface GuidedCollectionControlOptions {
  /** Starts collection after an explicit page-control action. */
  onStart(): Promise<GuidedCollectionStartResult>;
  /** Performs one explicit backward-scroll step. */
  onStepBackward(): GuidedScrollStepResult;
  /** Performs one explicit forward-scroll step. */
  onStepForward(): GuidedScrollForwardResult;
  /** Reveals supported spoilers in the current visible area. */
  onRevealSpoilers(): VisibleSpoilerRevealResult;
  /** Stops the owning collection session. */
  onStop(): void;
}

export interface VisibleSpoilerRevealResult {
  revealed: number;
  failed: number;
}

export type GuidedCollectionStartResult =
  { ok: true; collectedCount: number } | { ok: false; error: UserFacingError };

/** Moves the message container toward older posts by at most one visible page. */
export function scrollOnePageBackward(
  documentObject: Document,
  windowObject: Window,
): GuidedScrollStepResult {
  const container = findMessageScrollContainer(documentObject, windowObject);
  if (container === null) return { status: 'unavailable' };
  const previous = container.scrollTop;
  if (previous <= 0) return { status: 'at_start' };

  const distance = Math.max(1, Math.floor(container.clientHeight * SCROLL_RATIO));
  container.scrollTop = Math.max(0, previous - distance);
  const current = container.scrollTop;
  if (current === previous) return { status: 'at_start' };
  container.dispatchEvent(new Event('scroll'));
  return { status: 'moved', reachedStart: current === 0 };
}

/** Moves the message container toward newer posts by at most one visible page. */
export function scrollOnePageForward(
  documentObject: Document,
  windowObject: Window,
): GuidedScrollForwardResult {
  const container = findMessageScrollContainer(documentObject, windowObject);
  if (container === null) return { status: 'unavailable' };
  const previous = container.scrollTop;
  const maximum = Math.max(0, container.scrollHeight - container.clientHeight);
  if (previous >= maximum) return { status: 'at_end' };

  const distance = Math.max(1, Math.floor(container.clientHeight * SCROLL_RATIO));
  container.scrollTop = Math.min(maximum, previous + distance);
  const current = container.scrollTop;
  if (current === previous) return { status: 'at_end' };
  container.dispatchEvent(new Event('scroll'));
  return { status: 'moved', reachedEnd: current >= maximum };
}

/** Reveals only supported spoiler controls currently visible in the message viewport. */
export function revealVisibleSpoilers(
  documentObject: Document,
  windowObject: Window,
): VisibleSpoilerRevealResult {
  const messageViewport = findMessageViewport(documentObject);
  if (messageViewport === null) return { revealed: 0, failed: 0 };
  const visibleViewport = visibleMessageRect(messageViewport, windowObject);
  if (visibleViewport === null) return { revealed: 0, failed: 0 };

  let revealed = 0;
  let failed = 0;
  const elements = messageViewport.querySelectorAll<HTMLElement>(
    'button[aria-label], [role="button"][aria-label]',
  );
  for (const element of elements) {
    if (revealed + failed >= MAX_VISIBLE_SPOILERS_PER_ACTION) break;
    if (
      !isSpoilerControl(element) ||
      element.getAttribute('aria-expanded') === 'true' ||
      element.getAttribute('aria-disabled') === 'true' ||
      (element instanceof HTMLButtonElement && element.disabled)
    ) {
      continue;
    }
    if (!isElementVisibleInRect(element, visibleViewport, windowObject)) continue;
    try {
      element.click();
      revealed += 1;
    } catch {
      failed += 1;
    }
  }
  return { revealed, failed };
}

/** Renders and manages the explicit guided-collection controls on the Discord page. */
export class GuidedCollectionControls {
  private readonly host: HTMLDivElement;
  private readonly startButton: HTMLButtonElement;
  private readonly backwardButton: HTMLButtonElement;
  private readonly forwardButton: HTMLButtonElement;
  private readonly revealButton: HTMLButtonElement;
  private readonly stopButton: HTMLButtonElement;
  private readonly status: HTMLSpanElement;
  private readonly title: HTMLSpanElement;
  private translator: Translator;
  private statusMessage:
    { key: TranslationKey; params?: TranslationParams } | { error: UserFacingError } = {
    key: 'guide_inactive',
  };
  private active = false;
  private starting = false;
  private limitReached = false;

  constructor(
    documentObject: Document,
    private readonly options: GuidedCollectionControlOptions,
    translator: Translator = createTranslator('ja'),
  ) {
    this.translator = translator;
    documentObject.getElementById(CONTROL_HOST_ID)?.remove();
    this.host = documentObject.createElement('div');
    this.host.id = CONTROL_HOST_ID;
    this.host.setAttribute('role', 'region');
    this.host.setAttribute('aria-label', this.translator.t('guide_aria'));

    const shadow = this.host.attachShadow({ mode: 'open' });
    const style = documentObject.createElement('style');
    style.textContent = `
      :host { all: initial; }
      .panel {
        position: fixed;
        right: 16px;
        bottom: 16px;
        z-index: 2147483647;
        display: grid;
        gap: 8px;
        width: 230px;
        box-sizing: border-box;
        padding: 12px;
        border: 1px solid #5865f2;
        border-radius: 10px;
        background: #1e1f22;
        color: #f2f3f5;
        font: 13px/1.4 system-ui, sans-serif;
        box-shadow: 0 8px 24px rgb(0 0 0 / 35%);
      }
      .title { font-weight: 700; }
      .actions { display: flex; flex-wrap: wrap; gap: 8px; }
      button {
        min-height: 34px;
        border: 0;
        border-radius: 6px;
        padding: 6px 10px;
        color: #fff;
        background: #5865f2;
        font: inherit;
        cursor: pointer;
      }
      button.secondary { background: #4e5058; }
      button[hidden] { display: none; }
      button:disabled { cursor: not-allowed; opacity: .55; }
      button:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
      .status { color: #b5bac1; }
    `;

    const panel = documentObject.createElement('div');
    panel.className = 'panel';
    this.title = documentObject.createElement('span');
    this.title.className = 'title';
    this.status = documentObject.createElement('span');
    this.status.className = 'status';
    this.status.setAttribute('aria-live', 'polite');

    const actions = documentObject.createElement('div');
    actions.className = 'actions';
    this.startButton = documentObject.createElement('button');
    this.startButton.type = 'button';
    this.startButton.addEventListener('click', this.handleStart);
    this.backwardButton = documentObject.createElement('button');
    this.backwardButton.type = 'button';
    this.backwardButton.addEventListener('click', this.handleBackwardStep);
    this.forwardButton = documentObject.createElement('button');
    this.forwardButton.type = 'button';
    this.forwardButton.addEventListener('click', this.handleForwardStep);
    this.revealButton = documentObject.createElement('button');
    this.revealButton.type = 'button';
    this.revealButton.className = 'secondary';
    this.revealButton.addEventListener('click', this.handleReveal);
    this.stopButton = documentObject.createElement('button');
    this.stopButton.type = 'button';
    this.stopButton.className = 'secondary';
    this.stopButton.addEventListener('click', this.handleStop);

    actions.append(
      this.startButton,
      this.backwardButton,
      this.forwardButton,
      this.revealButton,
      this.stopButton,
    );
    panel.append(this.title, this.status, actions);
    shadow.append(style, panel);
    documentObject.body.append(this.host);
    this.renderStaticText();
    this.showInactive();
  }

  /** Re-renders the existing controls without changing collection state. */
  setTranslator(translator: Translator): void {
    this.translator = translator;
    this.renderStaticText();
    this.renderStatus();
  }

  /** Shows the explicit collection launcher without scanning the page. */
  showInactive(error?: UserFacingError): void {
    this.active = false;
    this.starting = false;
    this.limitReached = false;
    this.startButton.hidden = false;
    this.startButton.disabled = false;
    this.backwardButton.hidden = true;
    this.forwardButton.hidden = true;
    this.revealButton.hidden = true;
    this.stopButton.hidden = true;
    this.statusMessage = error === undefined ? { key: 'guide_inactive' } : { error };
    this.renderStatus();
  }

  /** Shows the controls for an active collection session. */
  showActive(collectedCount: number): void {
    this.active = true;
    this.starting = false;
    this.startButton.hidden = true;
    this.backwardButton.hidden = false;
    this.forwardButton.hidden = false;
    this.revealButton.hidden = false;
    this.stopButton.hidden = false;
    this.setCollectedCount(collectedCount);
  }

  /** Updates collection progress and disables collection actions at the hard limit. */
  setCollectedCount(count: number): void {
    if (!this.active) return;
    if (count >= COLLECTION_LIMIT) {
      this.limitReached = true;
      this.backwardButton.disabled = true;
      this.forwardButton.disabled = true;
      this.revealButton.disabled = true;
      this.setStatus('guide_limit', { limit: COLLECTION_LIMIT });
      return;
    }
    this.limitReached = false;
    this.backwardButton.disabled = false;
    this.forwardButton.disabled = false;
    this.revealButton.disabled = false;
    this.setStatus('guide_collecting', { count });
  }

  /** Detaches event listeners and removes the injected control host. */
  remove(): void {
    this.startButton.removeEventListener('click', this.handleStart);
    this.backwardButton.removeEventListener('click', this.handleBackwardStep);
    this.forwardButton.removeEventListener('click', this.handleForwardStep);
    this.revealButton.removeEventListener('click', this.handleReveal);
    this.stopButton.removeEventListener('click', this.handleStop);
    this.host.remove();
  }

  /** Handles one explicit request to start collection from the page. */
  private readonly handleStart = (): void => {
    if (this.active || this.starting) return;
    this.starting = true;
    this.startButton.disabled = true;
    this.setStatus('guide_starting');
    void this.options
      .onStart()
      .then((result) => {
        if (result.ok) {
          this.showActive(result.collectedCount);
        } else {
          this.showInactive(result.error);
        }
      })
      .catch(() => this.showInactive({ code: 'COLLECTOR_START_FAILED' }));
  };

  /** Handles one explicit backward-scroll action. */
  private readonly handleBackwardStep = (): void => {
    if (this.limitReached) return;
    this.backwardButton.disabled = true;
    const result = this.options.onStepBackward();
    if (result.status === 'moved') {
      this.setStatus(result.reachedStart ? 'guide_reached_start' : 'guide_moved_back');
    } else if (result.status === 'at_start') {
      this.setStatus('guide_at_start');
    } else {
      this.setStatus('guide_scroll_unavailable');
    }
    this.backwardButton.disabled = false;
  };

  /** Handles one explicit forward-scroll action. */
  private readonly handleForwardStep = (): void => {
    if (this.limitReached) return;
    this.forwardButton.disabled = true;
    const result = this.options.onStepForward();
    if (result.status === 'moved') {
      this.setStatus(result.reachedEnd ? 'guide_reached_end' : 'guide_moved_forward');
    } else if (result.status === 'at_end') {
      this.setStatus('guide_at_end');
    } else {
      this.setStatus('guide_scroll_unavailable');
    }
    this.forwardButton.disabled = false;
  };

  /** Handles the explicit request to stop guided collection. */
  private readonly handleStop = (): void => {
    this.options.onStop();
  };

  /** Handles one explicit visible-spoiler reveal action. */
  private readonly handleReveal = (): void => {
    if (this.limitReached) return;
    this.revealButton.disabled = true;
    const result = this.options.onRevealSpoilers();
    if (result.revealed === 0 && result.failed === 0) {
      this.setStatus('guide_no_spoilers');
    } else if (result.failed === 0) {
      this.setStatus('guide_spoilers_revealed', { revealed: result.revealed });
    } else {
      this.setStatus('guide_spoilers_partial', {
        revealed: result.revealed,
        failed: result.failed,
      });
    }
    this.revealButton.disabled = false;
  };

  private renderStaticText(): void {
    this.host.setAttribute('aria-label', this.translator.t('guide_aria'));
    this.title.textContent = this.translator.t('guide_title');
    this.startButton.textContent = this.translator.t('guide_start');
    this.backwardButton.textContent = this.translator.t('guide_back');
    this.forwardButton.textContent = this.translator.t('guide_forward');
    this.revealButton.textContent = this.translator.t('guide_reveal');
    this.stopButton.textContent = this.translator.t('guide_stop');
  }

  private setStatus(key: TranslationKey, params?: TranslationParams): void {
    this.statusMessage = params === undefined ? { key } : { key, params };
    this.renderStatus();
  }

  private renderStatus(): void {
    this.status.textContent =
      'error' in this.statusMessage
        ? this.translator.error(this.statusMessage.error)
        : this.translator.t(this.statusMessage.key, this.statusMessage.params);
  }
}

/** Returns the visible portion of the Discord message viewport. */
function visibleMessageRect(messageViewport: Element, windowObject: Window): RectLike | null {
  return intersectRects(messageViewport.getBoundingClientRect(), {
    top: 0,
    right: windowObject.innerWidth,
    bottom: windowObject.innerHeight,
    left: 0,
    width: windowObject.innerWidth,
    height: windowObject.innerHeight,
  });
}

/** Reports whether an accessible control label identifies a spoiler action. */
function isSpoilerControl(element: Element): boolean {
  const label = element.getAttribute('aria-label')?.normalize('NFKC').toLocaleLowerCase() ?? '';
  return discordSpoilerLabelTerms.some((term) => label.includes(term));
}
