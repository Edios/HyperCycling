import { create } from 'zustand';

/** The browser's install prompt (Chrome, Edge, Android); not in the DOM typings. */
export interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

interface PwaState {
  /** Saved `beforeinstallprompt`, offered by the "Install" button; undefined when not offered. */
  installPrompt: InstallPromptEvent | undefined;
  /** Installed during this visit (`appinstalled`). */
  installed: boolean;
  /** A new version is installed and waits for the page to let it take over. */
  waiting: ServiceWorker | undefined;
}

export const usePwaStore = create<PwaState>(() => ({
  installPrompt: undefined,
  installed: false,
  waiting: undefined,
}));

/** Opens the browser's own install dialog; the saved prompt can be used once. */
export async function promptInstall(): Promise<void> {
  const event = usePwaStore.getState().installPrompt;
  if (!event) return;
  usePwaStore.setState({ installPrompt: undefined });
  await event.prompt();
  const { outcome } = await event.userChoice;
  if (outcome === 'accepted') usePwaStore.setState({ installed: true });
}

/** Lets the waiting version take over; the page reloads once it controls it. */
export function applyUpdate(): void {
  const waiting = usePwaStore.getState().waiting;
  if (!waiting) return;
  reloadOnControllerChange = true;
  waiting.postMessage('hc-skip-waiting');
}

let reloadOnControllerChange = false;

/** True when the app runs as an installed app (its own window, no browser bar). */
export function isStandalone(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean };
  return (
    nav.standalone === true ||
    (typeof matchMedia === 'function' && matchMedia('(display-mode: standalone)').matches)
  );
}

/** iPhone and iPad (also iPadOS in desktop mode): no install prompt, only "Add to Home Screen". */
export function isIos(
  userAgent = navigator.userAgent,
  touchPoints = navigator.maxTouchPoints,
): boolean {
  return /iPhone|iPad|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && touchPoints > 1);
}

/** Listens for the install prompt; call once, before the first render. */
export function listenForInstallPrompt(): void {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // no browser mini-bar: the app offers it in How it works and Settings
    usePwaStore.setState({ installPrompt: e as InstallPromptEvent });
  });
  window.addEventListener('appinstalled', () =>
    usePwaStore.setState({ installed: true, installPrompt: undefined }),
  );
}

const E2E_FLAG = 'hypercycling.e2e.sw';

/**
 * Registers `sw.js` in production builds. The e2e build registers it only when a test asks for it
 * (a service worker would sit between Playwright's network mocks and the page in every other test).
 */
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  if (import.meta.env.VITE_E2E === '1') {
    try {
      if (localStorage.getItem(E2E_FLAG) !== '1') return;
    } catch {
      return;
    }
  }
  const base = import.meta.env.BASE_URL;
  const sw = navigator.serviceWorker;
  sw.addEventListener('controllerchange', () => {
    if (reloadOnControllerChange) location.reload();
  });
  void sw
    .register(`${base}sw.js`, { scope: base })
    .then((reg) => {
      const offer = (worker: ServiceWorker | null): void => {
        // Only an update waits: the first install has no controller and takes over by itself.
        if (worker && sw.controller) usePwaStore.setState({ waiting: worker });
      };
      offer(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const worker = reg.installing;
        worker?.addEventListener('statechange', () => {
          if (worker.state === 'installed') offer(worker);
        });
      });
      // A tab left open for days still learns about a new version when it is looked at again.
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') void reg.update().catch(() => undefined);
      });
    })
    .catch((err: unknown) => console.warn('Service worker registration failed', err));
}
