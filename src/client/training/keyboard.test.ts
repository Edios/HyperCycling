import { describe, expect, it, vi } from 'vitest';
import { bindTrainingKeys, type TrainingKeyActions } from './keyboard';

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

  it('leaves Space to a focused button', () => {
    const { actions, unbind } = setup();
    const btn = document.createElement('button');
    document.body.append(btn);
    const e = new KeyboardEvent('keydown', { code: 'Space', bubbles: true, cancelable: true });
    btn.dispatchEvent(e);
    expect(actions.toggle).not.toHaveBeenCalled();
    expect(e.defaultPrevented).toBe(false);
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
