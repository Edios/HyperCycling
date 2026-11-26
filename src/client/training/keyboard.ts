import type { MessageKey } from '../i18n';

export interface TrainingKeyActions {
  /** Start when idle, pause/resume otherwise. */
  toggle(): void;
  prev(): void;
  next(): void;
  togglePlayers(): void;
  /** Next overlay layout (World only; ignored elsewhere). */
  cycleLayout?(): void;
  fullscreen(): void;
  mute(): void;
  escape(): void;
  /** The next song of the music (the workout goes on). */
  nextSong?(): void;
  /** Trainer load +1 / -1 step (ERG); left out when no trainer takes the load. */
  harder?(): void;
  easier?(): void;
  /** Shows (or hides) the list of these shortcuts. */
  help?(): void;
}

/** One training shortcut; the key handler and the Settings card both read this list. */
export interface TrainingShortcut {
  /**
   * KeyboardEvent.code values: the key's place, whatever the layout. Media keys and presentation
   * remotes (HID) send ordinary key events, so they are codes here too.
   */
  codes: readonly string[];
  /** KeyboardEvent.key values: a character wherever it sits on the layout ("?", "+"). */
  chars?: readonly string[];
  /** What the key cap shows. */
  keys: string;
  action: keyof TrainingKeyActions;
  labelKey: MessageKey;
}

export const TRAINING_SHORTCUTS: readonly TrainingShortcut[] = [
  {
    codes: ['Space', 'MediaPlayPause'],
    keys: 'Space · ⏯',
    action: 'toggle',
    labelKey: 'shortcuts.toggle',
  },
  { codes: ['ArrowLeft'], keys: '←', action: 'prev', labelKey: 'shortcuts.prev' },
  { codes: ['ArrowRight'], keys: '→', action: 'next', labelKey: 'shortcuts.next' },
  {
    codes: ['KeyN', 'MediaTrackNext'],
    keys: 'N · ⏭',
    action: 'nextSong',
    labelKey: 'shortcuts.nextSong',
  },
  {
    codes: ['ArrowUp', 'Equal', 'NumpadAdd'],
    chars: ['+'],
    keys: '↑ · +',
    action: 'harder',
    labelKey: 'shortcuts.harder',
  },
  {
    codes: ['ArrowDown', 'Minus', 'NumpadSubtract'],
    chars: ['-'],
    keys: '↓ · −',
    action: 'easier',
    labelKey: 'shortcuts.easier',
  },
  { codes: ['KeyG'], keys: 'G', action: 'togglePlayers', labelKey: 'shortcuts.togglePlayers' },
  { codes: ['KeyH'], keys: 'H', action: 'cycleLayout', labelKey: 'shortcuts.cycleLayout' },
  { codes: ['KeyF'], keys: 'F', action: 'fullscreen', labelKey: 'shortcuts.fullscreen' },
  { codes: ['KeyM'], keys: 'M', action: 'mute', labelKey: 'shortcuts.mute' },
  { codes: [], chars: ['?'], keys: '?', action: 'help', labelKey: 'shortcuts.help' },
  { codes: ['Escape'], keys: 'Esc', action: 'escape', labelKey: 'shortcuts.escape' },
];

/** The shortcut of a key event: by its code first, then by the character it types. */
export function shortcutFor(e: Pick<KeyboardEvent, 'code' | 'key'>): TrainingShortcut | undefined {
  return (
    TRAINING_SHORTCUTS.find((s) => s.codes.includes(e.code)) ??
    TRAINING_SHORTCUTS.find((s) => s.chars?.includes(e.key))
  );
}
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
    const shortcut = shortcutFor(e);
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
