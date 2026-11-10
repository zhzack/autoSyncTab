import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PopupApp } from '../popup/PopupApp';
import { createDefaultStore, prependGroup, saveStore } from '../shared/storage';
import { chromeMockControls } from './setup';

describe('PopupApp', () => {
  beforeEach(async () => {
    chromeMockControls.reset();
    chromeMockControls.tabsList = [
      { id: 1, windowId: 7, url: 'https://react.dev', title: 'React', active: true, pinned: false } as chrome.tabs.Tab,
      { id: 2, windowId: 7, url: 'https://vite.dev', title: 'Vite', active: false, pinned: false } as chrome.tabs.Tab,
      { id: 3, windowId: 7, url: 'chrome://extensions/', title: 'Extensions', active: false, pinned: false } as chrome.tabs.Tab,
    ];

    const base = createDefaultStore(100);
    const { nextStore } = prependGroup(base, [
      { id: 't1', url: 'https://github.com', title: 'GitHub' },
    ]);
    await saveStore(nextStore);
  });

  it('displays eligible tab counts and dispatches stash command to background', async () => {
    render(<PopupApp />);

    expect(await screen.findByText('已保存 1 组 · 1 个标签')).toBeInTheDocument();

    const stashAllBtn = screen.getByRole('button', { name: /收纳当前窗口全部标签页/ });
    expect(stashAllBtn).toHaveTextContent('2');

    const stashCurrentBtn = screen.getByRole('button', { name: /仅收纳当前标签页/ });
    expect(stashCurrentBtn).toHaveTextContent('1');

    const stashOthersBtn = screen.getByRole('button', { name: /收纳其他标签页/ });
    expect(stashOthersBtn).toHaveTextContent('1');

    fireEvent.click(stashAllBtn);
    await waitFor(() => {
      expect(chromeMockControls.sentMessages).toContainEqual({
        type: 'STASH_TABS',
        scope: 'all',
        windowId: 7,
      });
    });
  });
});
