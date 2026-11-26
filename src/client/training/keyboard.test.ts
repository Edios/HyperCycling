import { describe, expect, it, vi } from 'vitest';
import { bindTrainingKeys, TRAINING_SHORTCUTS, type TrainingKeyActions } from './keyboard';

function setup() {
  const actions: TrainingKeyActions = {
    toggle: vi.fn(),
    prev: vi.fn(),
    next: vi.fn(),
    togglePlayers: vi.fn(),
    fullscreen: vi.fn(),
    mute: vi.fn(),
    escape: vi.fn(),
  };
  const unbind = bindTrainingKeys(window, actions);
  return { actions, unbind };
}

function press(code: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const e = new KeyboardEvent('keydown', { code, key: code, cancelable: true, ...init });
  window.dispatchEvent(e);
  return e;
}

describe('bindTrainingKeys', () => {
  it('maps keys to actions', () => {
    const { actions, unbind } = setup();
    const space = press('Space', { key: ' ' });
    press('ArrowLeft');
    press('ArrowRight');
    press('KeyG', { key: 'g' });
    press('KeyF', { key: 'f' });
    press('KeyM', { key: 'm' });
    press('Escape');
    expect(space.defaultPrevented).toBe(true);
    expect(actions.toggle).toHaveBeenCalledTimes(1);
    expect(actions.prev).toHaveBeenCalledTimes(1);
    expect(actions.next).toHaveBeenCalledTimes(1);
    expect(actions.togglePlayers).toHaveBeenCalledTimes(1);
    expect(actions.fullscreen).toHaveBeenCalledTimes(1);
    expect(actions.mute).toHaveBeenCalledTimes(1);
    expect(actions.escape).toHaveBeenCalledTimes(1);
    unbind();
  });

  it('ignores auto-repeat and modified keys', () => {
    const { actions, unbind } = setup();
    press('Space', { repeat: true });
    press('KeyM', { ctrlKey: true });
    expect(actions.toggle).not.toHaveBeenCalled();
    expect(actions.mute).not.toHaveBeenCalled();
    unbind();
  });

  it('ignores typing in form fields', () => {
    const { actions, unbind } = setup();
    const input = document.createElement('input');
    document.body.append(input);
    input.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', bubbles: true }));
    expect(actions.toggle).not.toHaveBeenCalled();
    input.remove();
    unbind();
  });

  it('Escape works from a radio or checkbox (quick settings) but not from a text field', () => {
    const { actions, unbind } = setup();
    for (const type of ['radio', 'checkbox', 'text']) {
      const input = document.createElement('input');
      input.type = type;
      document.body.append(input);
      input.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', bubbles: true }));
      input.remove();
    }
    expect(actions.escape).toHaveBeenCalledTimes(2);
    unbind();
  });

  it('Space pauses even with a button focused, and does not click it', () => {
    const { actions, unbind } = setup();
    const btn = document.createElement('button');
    document.body.append(btn);
    const e = new KeyboardEvent('keydown', { code: 'Space', bubbles: true, cancelable: true });
    btn.dispatchEvent(e);
    expect(actions.toggle).toHaveBeenCalledTimes(1);
    expect(e.defaultPrevented).toBe(true);
    // Firefox clicks on keyup: that one is cancelled too.
    const up = new KeyboardEvent('keyup', { code: 'Space', bubbles: true, cancelable: true });
    btn.dispatchEvent(up);
    expect(up.defaultPrevented).toBe(true);
    expect(actions.toggle).toHaveBeenCalledTimes(1);
    btn.remove();
    unbind();
  });

  it('Space on a checkbox inside the quick settings pauses and is not a toggle', () => {
    const { actions, unbind } = setup();
    const panel = document.createElement('div');
    panel.dataset['quickSettings'] = '';
    const box = document.createElement('input');
    box.type = 'checkbox';
    panel.append(box);
    document.body.append(panel);
    const down = new KeyboardEvent('keydown', { code: 'Space', bubbles: true, cancelable: true });
    box.dispatchEvent(down);
    const up = new KeyboardEvent('keyup', { code: 'Space', bubbles: true, cancelable: true });
    box.dispatchEvent(up);
    expect(actions.toggle).toHaveBeenCalledTimes(1);
    expect(down.defaultPrevented).toBe(true);
    expect(up.defaultPrevented).toBe(true);
    panel.remove();
    unbind();
  });

  it('Enter on a focused button is left to the button', () => {
    const { actions, unbind } = setup();
    const btn = document.createElement('button');
    document.body.append(btn);
    const e = new KeyboardEvent('keydown', { code: 'Enter', bubbles: true, cancelable: true });
    btn.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(false);
    expect(actions.toggle).not.toHaveBeenCalled();
    btn.remove();
    unbind();
  });

  it('stops after unbind', () => {
    const { actions, unbind } = setup();
    unbind();
    press('Space');
    expect(actions.toggle).not.toHaveBeenCalled();
  });
});

describe('TRAINING_SHORTCUTS', () => {
  it('is the single source: every listed key triggers its listed action', () => {
    const calls: string[] = [];
    const actions: Required<TrainingKeyActions> = {
      toggle: () => calls.push('toggle'),
      prev: () => calls.push('prev'),
      next: () => calls.push('next'),
      togglePlayers: () => calls.push('togglePlayers'),
      cycleLayout: () => calls.push('cycleLayout'),
      fullscreen: () => calls.push('fullscreen'),
      mute: () => calls.push('mute'),
      escape: () => calls.push('escape'),
      nextSong: () => calls.push('nextSong'),
      harder: () => calls.push('harder'),
      easier: () => calls.push('easier'),
      help: () => calls.push('help'),
    };
    const unbind = bindTrainingKeys(window, actions);
    for (const s of TRAINING_SHORTCUTS) {
      for (const code of s.codes) {
        calls.length = 0;
        press(code);
        expect(calls, code).toEqual([s.action]);
      }
      for (const key of s.chars ?? []) {
        calls.length = 0;
        press('Unidentified', { key });
        expect(calls, key).toEqual([s.action]);
      }
    }
    unbind();
    expect(TRAINING_SHORTCUTS.length).toBe(12);
  });
});

describe('ride remotes and media keys', () => {
  function bind(extra: Partial<TrainingKeyActions> = {}) {
    const actions: TrainingKeyActions = {
      toggle: vi.fn(),
      prev: vi.fn(),
      next: vi.fn(),
      togglePlayers: vi.fn(),
      fullscreen: vi.fn(),
      mute: vi.fn(),
      escape: vi.fn(),
      nextSong: vi.fn(),
      harder: vi.fn(),
      easier: vi.fn(),
      help: vi.fn(),
      ...extra,
    };
    return { actions, unbind: bindTrainingKeys(window, actions) };
  }

  it('play/pause, next song and the trainer load from keys, media keys and remotes', () => {
    const { actions, unbind } = bind();
    press('MediaPlayPause', { key: 'MediaPlayPause' });
    press('MediaTrackNext', { key: 'MediaTrackNext' });
    press('KeyN', { key: 'n' });
    press('ArrowUp');
    press('Equal', { key: '+', shiftKey: true });
    press('NumpadAdd', { key: '+' });
    press('ArrowDown');
    press('Minus', { key: '-' });
    press('NumpadSubtract', { key: '-' });
    expect(actions.toggle).toHaveBeenCalledTimes(1);
    expect(actions.nextSong).toHaveBeenCalledTimes(2);
    expect(actions.harder).toHaveBeenCalledTimes(3);
    expect(actions.easier).toHaveBeenCalledTimes(3);
    unbind();
  });

  it('"?" opens the help, on any layout (by the character typed)', () => {
    const { actions, unbind } = bind();
    press('Slash', { key: '?', shiftKey: true });
    press('Comma', { key: '?', shiftKey: true }); // another keyboard layout
    expect(actions.help).toHaveBeenCalledTimes(2);
    // "/" alone is not "?".
    press('Slash', { key: '/' });
    expect(actions.help).toHaveBeenCalledTimes(2);
    unbind();
  });

  it('keeps typing in a field to the field', () => {
    const { actions, unbind } = bind();
    const input = document.createElement('input');
    document.body.append(input);
    for (const [code, key] of [
      ['KeyN', 'n'],
      ['Minus', '-'],
      ['Slash', '?'],
      ['ArrowUp', 'ArrowUp'],
    ] as const) {
      input.dispatchEvent(new KeyboardEvent('keydown', { code, key, bubbles: true }));
    }
    expect(actions.nextSong).not.toHaveBeenCalled();
    expect(actions.easier).not.toHaveBeenCalled();
    expect(actions.help).not.toHaveBeenCalled();
    expect(actions.harder).not.toHaveBeenCalled();
    input.remove();
    unbind();
  });

  it('lists every key once, and no key does two things', () => {
    const codes = TRAINING_SHORTCUTS.flatMap((s) => s.codes);
    expect(new Set(codes).size).toBe(codes.length);
    for (const code of ['MediaPlayPause', 'MediaTrackNext', 'KeyN', 'ArrowUp', 'ArrowDown']) {
      expect(codes).toContain(code);
    }
  });
});
