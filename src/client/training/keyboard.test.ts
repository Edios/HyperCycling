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
    };
    const unbind = bindTrainingKeys(window, actions);
    for (const s of TRAINING_SHORTCUTS) {
      calls.length = 0;
      press(s.code);
      expect(calls, s.code).toEqual([s.action]);
    }
    unbind();
    expect(TRAINING_SHORTCUTS.length).toBe(8);
  });
});
