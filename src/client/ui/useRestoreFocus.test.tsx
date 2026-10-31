import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useRestoreFocus } from './useRestoreFocus';

function Panel() {
  useRestoreFocus();
  return <button type="button">inside</button>;
}

describe('useRestoreFocus', () => {
  it('gives focus back to the element that had it before mounting', () => {
    const opener = document.createElement('button');
    document.body.append(opener);
    opener.focus();
    const { getByText, unmount } = render(<Panel />);
    getByText('inside').focus();
    unmount();
    expect(opener).toHaveFocus();
    opener.remove();
  });
});
