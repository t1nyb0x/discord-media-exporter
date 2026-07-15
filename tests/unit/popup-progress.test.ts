import { afterEach, describe, expect, it, vi } from 'vitest';
import popupFixture from '../../entrypoints/popup/index.html?raw';

const browserMocks = vi.hoisted(() => ({
  sendMessage: vi.fn(),
  queryTabs: vi.fn(),
  executeScript: vi.fn(),
}));

vi.mock('wxt/browser', () => ({
  browser: {
    runtime: { sendMessage: browserMocks.sendMessage },
    tabs: { query: browserMocks.queryTabs },
    scripting: { executeScript: browserMocks.executeScript },
  },
}));

describe('popup download progress', () => {
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('shows candidate-level completion and sanitized failure details', async () => {
    vi.useFakeTimers();
    browserMocks.sendMessage.mockResolvedValue({
      ok: true,
      type: 'DOWNLOAD_STATUS',
      state: {
        items: [
          {
            candidateId: 'media-11111111',
            filename: 'photo.png',
            status: 'complete',
            downloadId: 1,
          },
          {
            candidateId: 'media-22222222',
            filename: 'movie.mp4',
            status: 'failed',
            downloadId: 2,
            error: 'ダウンロードが中断されました (SERVER_FORBIDDEN)。',
          },
        ],
      },
    });
    loadPopupFixture();

    await import('../../entrypoints/popup/main');
    await Promise.resolve();
    await Promise.resolve();

    expect(document.getElementById('progress')?.hidden).toBe(false);
    expect(document.getElementById('progress-summary')?.textContent).toBe(
      '完了 1 / 進行中 0 / 待機 0 / 失敗 1',
    );
    const progressItems = document.querySelectorAll('#progress-list .progress-item');
    expect(progressItems).toHaveLength(2);
    expect(progressItems[0]?.textContent).toContain('完了');
    expect(progressItems[0]?.textContent).toContain('photo.png');
    expect(progressItems[1]?.textContent).toContain('失敗');
    expect(progressItems[1]?.textContent).toContain('SERVER_FORBIDDEN');
  });
});

function loadPopupFixture(): void {
  document.open();
  document.write(popupFixture);
  document.close();
}
