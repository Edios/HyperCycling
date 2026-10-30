import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { flattenWorkout } from '../../domain/segments';
import { builtinWorkouts } from '../data/builtin';
import { AppBar } from './AppBar';
import { Button } from './Button';
import { Chip } from './Chip';
import { Field } from './Field';
import { Modal } from './Modal';
import { ProfileChart } from './ProfileChart';
import { Segmented } from './Segmented';
import { Toast, ToastStack } from './Toast';
import { Toggle } from './Toggle';

describe('Button and Chip', () => {
  it('Button forwards clicks and respects disabled', () => {
    const onClick = vi.fn();
    render(
      <>
        <Button onClick={onClick}>Go</Button>
        <Button disabled title="Coming soon">
          Nope
        </Button>
      </>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Go' }));
    expect(onClick).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: 'Nope' })).toBeDisabled();
  });

  it('Chip exposes its state through aria-pressed', () => {
    const onClick = vi.fn();
    render(
      <>
        <Chip on onClick={onClick}>
          All
        </Chip>
        <Chip onClick={onClick}>HIIT</Chip>
      </>,
    );
    expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'HIIT' })).toHaveAttribute('aria-pressed', 'false');
  });
});

describe('Segmented and Toggle', () => {
  it('Segmented selects and skips disabled options', () => {
    const onChange = vi.fn();
    render(
      <Segmented
        label="Layout"
        value="a"
        onChange={onChange}
        options={[
          { value: 'a', label: 'A' },
          { value: 'b', label: 'B' },
          { value: 'c', label: 'C', disabled: true },
        ]}
      />,
    );
    expect(screen.getByRole('radio', { name: 'A' })).toBeChecked();
    fireEvent.click(screen.getByRole('radio', { name: 'B' }));
    expect(onChange).toHaveBeenCalledWith('b');
    expect(screen.getByRole('radio', { name: 'C' })).toBeDisabled();
  });

  it('Toggle is a labelled switch', () => {
    const onChange = vi.fn();
    render(<Toggle label="Beeps" checked={false} onChange={onChange} />);
    const sw = screen.getByRole('switch', { name: 'Beeps' });
    expect(sw).not.toBeChecked();
    fireEvent.click(sw);
    expect(onChange).toHaveBeenCalledWith(true);
  });
});

describe('Field, Modal, Toast', () => {
  it('Field links its label to the control', () => {
    render(<Field label="Name">{(id) => <input id={id} />}</Field>);
    expect(screen.getByLabelText('Name')).toBeInTheDocument();
  });

  it('Modal is a labelled dialog that closes on Escape', () => {
    const onClose = vi.fn();
    render(
      <Modal title="Pick one" onClose={onClose}>
        <p>body</p>
      </Modal>,
    );
    expect(screen.getByRole('dialog', { name: 'Pick one' })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('Toast announces its message', () => {
    render(<Toast message="Saved" onClose={() => {}} />);
    expect(screen.getByRole('status')).toHaveTextContent('Saved');
  });

  it('ToastStack shows several toasts in one column', () => {
    render(
      <ToastStack>
        <Toast message="First" onClose={() => {}} />
        <Toast message="Second" onClose={() => {}} />
      </ToastStack>,
    );
    const stack = screen.getByTestId('toast-stack');
    expect(stack).toContainElement(screen.getByText('First'));
    expect(stack).toContainElement(screen.getByText('Second'));
    expect(screen.getAllByTestId('toast-stack')).toHaveLength(1);
  });
});

describe('ProfileChart', () => {
  const w = builtinWorkouts[0];
  if (!w) throw new Error('no builtin workouts');
  const segments = flattenWorkout(w);

  it('draws one bar per segment', () => {
    render(<ProfileChart segments={segments} height={80} />);
    expect(screen.getByTestId('profile-chart').querySelectorAll('[data-bar]')).toHaveLength(
      segments.length,
    );
  });

  it('dims bars already ridden', () => {
    const first = segments[0];
    if (!first) throw new Error('no segments');
    render(<ProfileChart segments={segments} height={80} pastSec={first.durationSec} />);
    const bars = screen.getByTestId('profile-chart').querySelectorAll('[data-bar]');
    expect(bars[0]).toHaveAttribute('data-past', 'true');
    expect(bars[bars.length - 1]).toHaveAttribute('data-past', 'false');
  });

  it('renders empty input without crashing', () => {
    render(<ProfileChart segments={[]} height={80} />);
    expect(screen.getByTestId('profile-chart')).toBeInTheDocument();
  });
});

describe('AppBar', () => {
  it('marks the active tab and links to players and settings', () => {
    render(
      <MemoryRouter initialEntries={['/freestyle']}>
        <AppBar />
      </MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: 'Freestyle' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Plan' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: /Players/ })).toHaveAttribute('href', '/players');
    expect(screen.getByRole('link', { name: /Settings/ })).toHaveAttribute('href', '/settings');
  });
});

describe('Modal focus and Segmented ids', () => {
  it('focuses the first control, wraps Tab, and restores focus on close', () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    const onClose = vi.fn();
    const { unmount } = render(
      <Modal title="T" onClose={onClose}>
        <button type="button">One</button>
        <button type="button">Two</button>
      </Modal>,
    );
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
    const two = screen.getByRole('button', { name: 'Two' });
    two.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(two).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
    unmount();
    expect(opener).toHaveFocus();
    opener.remove();
  });

  it('two Segmented controls with the same label do not share a radio group', () => {
    const opts = [
      { value: 'a', label: 'A' },
      { value: 'b', label: 'B' },
    ];
    render(
      <>
        <Segmented label="Same" value="a" options={opts} onChange={() => {}} />
        <Segmented label="Same" value="b" options={opts} onChange={() => {}} />
      </>,
    );
    const radios = screen.getAllByRole('radio');
    expect(new Set(radios.map((r) => r.getAttribute('name'))).size).toBe(2);
    expect(radios.filter((r) => (r as HTMLInputElement).checked)).toHaveLength(2);
  });
});
