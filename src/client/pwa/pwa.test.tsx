import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InstallApp } from './InstallApp';
import { isIos, usePwaStore, type InstallPromptEvent } from './pwa-store';
import { UpdateNotice } from './UpdateNotice';

const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';
const IPAD_DESKTOP =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15';

beforeEach(() => {
  usePwaStore.setState({ installPrompt: undefined, installed: false, waiting: undefined });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function fakePrompt(outcome: 'accepted' | 'dismissed'): InstallPromptEvent {
  const e = new Event('beforeinstallprompt') as InstallPromptEvent;
  e.prompt = vi.fn(() => Promise.resolve());
  e.userChoice = Promise.resolve({ outcome });
  return e;
}

describe('isIos', () => {
  it('knows the iPhone and the iPad in desktop mode, not a Mac', () => {
    expect(isIos(IPHONE, 5)).toBe(true);
    expect(isIos(IPAD_DESKTOP, 5)).toBe(true);
    expect(isIos(IPAD_DESKTOP, 0)).toBe(false);
  });
});

describe('InstallApp', () => {
  it('shows nothing where the browser offers no install and it is not an iPhone', () => {
    const { container } = render(<InstallApp />);
    expect(container).toBeEmptyDOMElement();
  });

  it('offers the browser install dialog when it is available; accepted means installed', async () => {
    const prompt = fakePrompt('accepted');
    usePwaStore.setState({ installPrompt: prompt });
    render(<InstallApp />);
    fireEvent.click(screen.getByRole('button', { name: 'Install the app' }));
    expect(prompt.prompt).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(usePwaStore.getState().installed).toBe(true));
    expect(screen.queryByTestId('install-app')).toBeNull();
  });

  it('on an iPhone explains "Add to Home Screen"', () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(IPHONE);
    render(<InstallApp />);
    expect(screen.getByTestId('install-ios')).toHaveTextContent('Add to Home Screen');
  });

  it('shows nothing once running as an installed app', () => {
    usePwaStore.setState({ installPrompt: fakePrompt('accepted') });
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('standalone') }));
    const { container } = render(<InstallApp />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('UpdateNotice', () => {
  const worker = (): ServiceWorker => ({ postMessage: vi.fn() }) as unknown as ServiceWorker;
  const at = (path: string) =>
    render(
      <MemoryRouter initialEntries={[path]}>
        <UpdateNotice />
      </MemoryRouter>,
    );

  it('says a new version is ready; Refresh asks the waiting worker to take over', () => {
    const w = worker();
    usePwaStore.setState({ waiting: w });
    at('/freestyle');
    expect(screen.getByRole('status')).toHaveTextContent('A new version is ready.');
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(w.postMessage).toHaveBeenCalledWith('hc-skip-waiting');
  });

  it('can be put off, and never shows during a ride', () => {
    usePwaStore.setState({ waiting: worker() });
    const { unmount } = at('/');
    fireEvent.click(screen.getByRole('button', { name: 'Later' }));
    expect(screen.queryByTestId('update-notice')).toBeNull();
    unmount();
    at('/train');
    expect(screen.queryByTestId('update-notice')).toBeNull();
  });

  it('shows nothing without a waiting version', () => {
    at('/');
    expect(screen.queryByTestId('update-notice')).toBeNull();
  });
});
