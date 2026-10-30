export interface TrainingKeyActions {
  /** Start when idle, pause/resume otherwise. */
  toggle(): void;
  prev(): void;
  next(): void;
  togglePlayers(): void;
  fullscreen(): void;
  mute(): void;
  escape(): void;
}

function isTextField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName);
}

/** Binds the training shortcuts; returns the unbind function. */
export function bindTrainingKeys(target: Window, actions: TrainingKeyActions): () => void {
  const handler = (e: KeyboardEvent): void => {
    if (e.ctrlKey || e.metaKey || e.altKey || isTextField(e.target)) return;
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
    run();
  };
  target.addEventListener('keydown', handler);
  return () => target.removeEventListener('keydown', handler);
}
