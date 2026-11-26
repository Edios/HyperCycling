import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setLang } from '../i18n';
import { TRAINING_SHORTCUTS } from './keyboard';
import { ShortcutsHelp } from './ShortcutsHelp';

beforeEach(() => setLang('en'));

describe('ShortcutsHelp ("?" during the ride)', () => {
  it('lists every shortcut with its keys, and the remotes', () => {
    render(<ShortcutsHelp onClose={() => {}} />);
    const dialog = screen.getByRole('dialog', { name: 'Keyboard shortcuts' });
    expect(within(dialog).getAllByRole('listitem')).toHaveLength(TRAINING_SHORTCUTS.length);
    expect(dialog).toHaveTextContent('N · ⏭Next song');
    expect(dialog).toHaveTextContent('Media keys and presentation remotes work too');
    expect(within(dialog).getByRole('button', { name: 'Close' })).toHaveFocus();
  });

  it('closes with Escape, "?" and the button', () => {
    const onClose = vi.fn();
    render(<ShortcutsHelp onClose={onClose} />);
    const dialog = screen.getByRole('dialog');
    fireEvent.keyDown(dialog, { key: 'Escape', code: 'Escape' });
    fireEvent.keyDown(dialog, { key: '?', code: 'Slash', shiftKey: true });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it('closes with Escape also when the focus left it (a click outside), and on the backdrop', () => {
    const onClose = vi.fn();
    render(<ShortcutsHelp onClose={onClose} />);
    document.body.focus();
    fireEvent.keyDown(document.body, { key: 'Escape', code: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    const dialog = screen.getByRole('dialog');
    fireEvent.click(dialog); // inside: stays
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(dialog.parentElement!); // the backdrop
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
