import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { EndDialog } from './EndDialog';

function Harness({ open }: { open: boolean }) {
  return (
    <>
      <button type="button">Menu opener</button>
      {open && <EndDialog onResume={vi.fn()} onEnd={vi.fn()} onLeave={vi.fn()} />}
    </>
  );
}

describe('EndDialog focus', () => {
  it('moves focus into the dialog and gives it back to the opener on close', () => {
    const { rerender } = render(<Harness open={false} />);
    const opener = screen.getByRole('button', { name: 'Menu opener' });
    opener.focus();
    rerender(<Harness open />);
    expect(screen.getByRole('dialog')).toContainElement(document.activeElement as HTMLElement);
    rerender(<Harness open={false} />);
    expect(opener).toHaveFocus();
  });

  it('Shift+Tab from the first button wraps to the last one', () => {
    render(<Harness open />);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Tab', shiftKey: true });
    expect(screen.getByRole('dialog')).toContainElement(document.activeElement as HTMLElement);
  });
});
