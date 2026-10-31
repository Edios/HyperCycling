import type { MessageKey } from '../i18n';

export interface TrainingKeyActions {
  /** Start when idle, pause/resume otherwise. */
  toggle(): void;
  prev(): void;
  next(): void;
  togglePlayers(): void;
  /** Next overlay layout (Hyperride only; ignored elsewhere). */
  cycleLayout?(): void;
  fullscreen(): void;
  mute(): void;
  escape(): void;
}

/** One training shortcut; the key handler and the Settings card both read this list. */
export interface TrainingShortcut {
  /** KeyboardEvent.code. */
  code: string;
  /** What the key cap shows. */
  keys: string;
  action: keyof TrainingKeyActions;
  labelKey: MessageKey;
}

export const TRAINING_SHORTCUTS: readonly TrainingShortcut[] = [
  { code: 'Space', keys: 'Space', action: 'toggle', labelKey: 'shortcuts.toggle' },
  { code: 'ArrowLeft', keys: '←', action: 'prev', labelKey: 'shortcuts.prev' },
  { code: 'ArrowRight', keys: '→', action: 'next', labelKey: 'shortcuts.next' },
  { code: 'KeyG', keys: 'G', action: 'togglePlayers', labelKey: 'shortcuts.togglePlayers' },
  { code: 'KeyH', keys: 'H', action: 'cycleLayout', labelKey: 'shortcuts.cycleLayout' },
  { code: 'KeyF', keys: 'F', action: 'fullscreen', labelKey: 'shortcuts.fullscreen' },
  { code: 'KeyM', keys: 'M', action: 'mute', labelKey: 'shortcuts.mute' },
  { code: 'Escape', keys: 'Esc', action: 'escape', labelKey: 'shortcuts.escape' },
];
function isTextField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName);
}

/** Radios and checkboxes (the quick settings): Escape still reaches the screen from them. */
function isChoiceInput(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement && (target.type === 'radio' || target.type === 'checkbox')
  );
}

/** Buttons and links activate themselves with Enter (and Space, which is ours here). */
function isActivatable(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && /^(BUTTON|A|SUMMARY)$/.test(target.tagName);
}

/** Space on a switch / radio of the quick settings pauses the ride (R22) instead of toggling it. */
function isQuickChoice(target: EventTarget | null): boolean {
  return isChoiceInput(target) && (target as HTMLElement).closest('[data-quick-settings]') !== null;
}

/** Binds the training shortcuts; returns the unbind function. */
export function bindTrainingKeys(target: Window, actions: TrainingKeyActions): () => void {
  const handler = (e: KeyboardEvent): void => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (
      isTextField(e.target) &&
      !(e.code === 'Escape' && isChoiceInput(e.target)) &&
      !(e.code === 'Space' && isQuickChoice(e.target))
    ) {
      return;
    }
    // Space is a global pause/resume (R22), also on a focused button; Enter stays with the button.
    if (e.code === 'Enter' && isActivatable(e.target)) return;
    const shortcut = TRAINING_SHORTCUTS.find((s) => s.code === e.code);
    if (!shortcut) return;
    const run = actions[shortcut.action];
    // Space would otherwise scroll or click the focused button.
    e.preventDefault();
    if (e.repeat) return;
    run?.();
  };
  // Firefox activates a button on Space keyup: swallow it so the keydown action is the only one.
  const upHandler = (e: KeyboardEvent): void => {
    if (
      e.code === 'Space' &&
      (isActivatable(e.target) || isQuickChoice(e.target)) &&
      !e.ctrlKey &&
      !e.metaKey &&
      !e.altKey
    ) {
      e.preventDefault();
    }
  };
  target.addEventListener('keydown', handler);
  target.addEventListener('keyup', upHandler);
  return () => {
    target.removeEventListener('keydown', handler);
    target.removeEventListener('keyup', upHandler);
  };
}
