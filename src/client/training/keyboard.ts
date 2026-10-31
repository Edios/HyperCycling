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

/** Binds the training shortcuts; returns the unbind function. */
export function bindTrainingKeys(target: Window, actions: TrainingKeyActions): () => void {
  const handler = (e: KeyboardEvent): void => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (isTextField(e.target) && !(e.code === 'Escape' && isChoiceInput(e.target))) return;
    // Space is a global pause/resume (R22), also on a focused button; Enter stays with the button.
    if (e.code === 'Enter' && isActivatable(e.target)) return;
    let run: (() => void) | undefined;
    switch (e.code) {
      case 'Space':
        run = actions.toggle;
        break;
      case 'ArrowLeft':
        run = actions.prev;
        break;
      case 'ArrowRight':
        run = actions.next;
        break;
      case 'KeyG':
        run = actions.togglePlayers;
        break;
      case 'KeyH':
        run = actions.cycleLayout;
        break;
      case 'KeyF':
        run = actions.fullscreen;
        break;
      case 'KeyM':
        run = actions.mute;
        break;
      case 'Escape':
        run = actions.escape;
        break;
      default:
        return;
    }
    // Space would otherwise scroll or click the focused button.
    e.preventDefault();
    if (e.repeat) return;
    run?.();
  };
  // Firefox activates a button on Space keyup: swallow it so the keydown action is the only one.
  const upHandler = (e: KeyboardEvent): void => {
    if (e.code === 'Space' && isActivatable(e.target) && !e.ctrlKey && !e.metaKey && !e.altKey) {
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
