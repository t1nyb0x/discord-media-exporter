import { findMessageScrollContainer, findMessageViewport } from './message-viewport';
import { intersectRects, isElementVisibleInRect, type RectLike } from './visibility';

const SCROLL_RATIO = 0.8;
const COLLECTION_LIMIT = 500;
const MAX_VISIBLE_SPOILERS_PER_ACTION = 50;
const CONTROL_HOST_ID = 'discord-media-exporter-guided-controls';

export type GuidedScrollStepResult =
  { status: 'moved'; reachedStart: boolean } | { status: 'at_start' } | { status: 'unavailable' };

interface GuidedCollectionControlOptions {
  onStep(): GuidedScrollStepResult;
  onRevealSpoilers(): VisibleSpoilerRevealResult;
  onStop(): void;
}

export interface VisibleSpoilerRevealResult {
  revealed: number;
  failed: number;
}

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

export class GuidedCollectionControls {
  private readonly host: HTMLDivElement;
  private readonly stepButton: HTMLButtonElement;
  private readonly revealButton: HTMLButtonElement;
  private readonly stopButton: HTMLButtonElement;
  private readonly status: HTMLSpanElement;
  private limitReached = false;

  constructor(
    documentObject: Document,
    private readonly options: GuidedCollectionControlOptions,
  ) {
    documentObject.getElementById(CONTROL_HOST_ID)?.remove();
    this.host = documentObject.createElement('div');
    this.host.id = CONTROL_HOST_ID;
    this.host.setAttribute('role', 'region');
    this.host.setAttribute('aria-label', 'Discord Media Exporter ガイド付き収集');

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
      button:disabled { cursor: not-allowed; opacity: .55; }
      button:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
      .status { color: #b5bac1; }
    `;

    const panel = documentObject.createElement('div');
    panel.className = 'panel';
    const title = documentObject.createElement('span');
    title.className = 'title';
    title.textContent = 'ガイド付き収集';
    this.status = documentObject.createElement('span');
    this.status.className = 'status';
    this.status.setAttribute('aria-live', 'polite');
    this.status.textContent = '操作ごとに古い投稿へ1画面戻ります。';

    const actions = documentObject.createElement('div');
    actions.className = 'actions';
    this.stepButton = documentObject.createElement('button');
    this.stepButton.type = 'button';
    this.stepButton.textContent = '1画面戻る';
    this.stepButton.addEventListener('click', this.handleStep);
    this.revealButton = documentObject.createElement('button');
    this.revealButton.type = 'button';
    this.revealButton.className = 'secondary';
    this.revealButton.textContent = '表示中のスポイラーを解除';
    this.revealButton.addEventListener('click', this.handleReveal);
    this.stopButton = documentObject.createElement('button');
    this.stopButton.type = 'button';
    this.stopButton.className = 'secondary';
    this.stopButton.textContent = '停止';
    this.stopButton.addEventListener('click', this.handleStop);

    actions.append(this.stepButton, this.revealButton, this.stopButton);
    panel.append(title, this.status, actions);
    shadow.append(style, panel);
    documentObject.body.append(this.host);
  }

  setCollectedCount(count: number): void {
    if (count >= COLLECTION_LIMIT) {
      this.limitReached = true;
      this.stepButton.disabled = true;
      this.revealButton.disabled = true;
      this.status.textContent = `収集上限の${COLLECTION_LIMIT}件に達しました。`;
      return;
    }
    this.limitReached = false;
    this.stepButton.disabled = false;
    this.revealButton.disabled = false;
    this.status.textContent = `${count}件を収集中です。`;
  }

  remove(): void {
    this.stepButton.removeEventListener('click', this.handleStep);
    this.revealButton.removeEventListener('click', this.handleReveal);
    this.stopButton.removeEventListener('click', this.handleStop);
    this.host.remove();
  }

  private readonly handleStep = (): void => {
    if (this.limitReached) return;
    this.stepButton.disabled = true;
    const result = this.options.onStep();
    if (result.status === 'moved') {
      this.status.textContent = result.reachedStart
        ? '上端へ移動しました。読み込み後、必要ならもう一度押してください。'
        : '1画面戻りました。表示された候補を収集します。';
    } else if (result.status === 'at_start') {
      this.status.textContent = '現在は上端です。古い投稿の読み込み後にもう一度押してください。';
    } else {
      this.status.textContent = 'メッセージのスクロール領域を確認できませんでした。';
    }
    this.stepButton.disabled = false;
  };

  private readonly handleStop = (): void => {
    this.options.onStop();
  };

  private readonly handleReveal = (): void => {
    if (this.limitReached) return;
    this.revealButton.disabled = true;
    const result = this.options.onRevealSpoilers();
    if (result.revealed === 0 && result.failed === 0) {
      this.status.textContent = '現在の表示範囲に解除できるスポイラーはありません。';
    } else if (result.failed === 0) {
      this.status.textContent = `${result.revealed}件のスポイラーを解除しました。表示後に収集します。`;
    } else {
      this.status.textContent = `${result.revealed}件を解除し、${result.failed}件は解除できませんでした。`;
    }
    this.revealButton.disabled = false;
  };
}

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

function isSpoilerControl(element: Element): boolean {
  const label = element.getAttribute('aria-label')?.normalize('NFKC').toLocaleLowerCase() ?? '';
  return label.includes('spoiler') || label.includes('スポイラー') || label.includes('ネタバレ');
}
