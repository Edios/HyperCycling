import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { FakeHrSensor } from '../../domain/ble/fake-hr';
import { FakeTrainer } from '../../domain/ble/fake-trainer';
import { setLang } from '../i18n';
import { createDeviceStore, type DeviceStore } from './device-store';
import { DevicesPanel, type DevicesPanelProps } from './DevicesPanel';
import { FakeBluetooth } from './fake-bluetooth';
import { DeviceStoreContext } from './useDevices';

const noWakeLock = { acquire: async () => {}, release: async () => {} };

function mount(
  store: DeviceStore,
  props: Partial<DevicesPanelProps> = {},
): ReturnType<typeof render> {
  return render(
    <DeviceStoreContext.Provider value={store}>
      <DevicesPanel variant="full" showTrainer showWatts {...props} />
    </DeviceStoreContext.Provider>,
  );
}

function fakeStore(options: ConstructorParameters<typeof FakeBluetooth>[0] = {}) {
  const bluetooth = new FakeBluetooth(options);
  const store = createDeviceStore({
    support: { supported: true, bluetooth },
    wakeLock: noWakeLock,
    backoffMs: [20],
  });
  return { bluetooth, store };
}

beforeEach(() => setLang('en'));

describe('DevicesPanel', () => {
  it('announces state changes only; live values stay outside the live region', async () => {
    const { bluetooth, store } = fakeStore({ trainer: new FakeTrainer({ noiseW: 0 }) });
    mount(store);
    await act(() => store.connect('trainer'));
    await act(() => store.connect('hr'));
    act(() => {
      for (let t = 1000; t <= 30_000; t += 1000) bluetooth.pump(t);
    });
    for (const kind of ['trainer', 'hr'] as const) {
      const row = screen.getByTestId(`device-${kind}`);
      const region = within(row).getByRole('status');
      expect(region).toHaveTextContent(/^Connected$/);
      expect(region).toHaveAttribute('aria-live', 'polite');
      const live = within(row).getByTestId(`device-${kind}-live`);
      expect(live).toHaveAttribute('aria-live', 'off');
      expect(
        live.closest('[role="status"], [aria-live="polite"], [aria-live="assertive"]'),
      ).toBeNull();
    }
    expect(screen.getByTestId('device-trainer-live')).toHaveTextContent('100 W · 90 rpm');
    expect(screen.getByTestId('device-hr-live')).toHaveTextContent('120 bpm');
  });

  it('connects the trainer and shows its name, watts and cadence', async () => {
    const { bluetooth, store } = fakeStore({ trainer: new FakeTrainer({ noiseW: 0 }) });
    mount(store);
    const row = screen.getByTestId('device-trainer');
    expect(within(row).getByText('Not connected')).toBeInTheDocument();
    fireEvent.click(within(row).getByRole('button', { name: 'Connect trainer' }));
    await waitFor(() => expect(row).toHaveAttribute('data-status', 'connected'));
    expect(within(row).getByText('Fake Trainer 0001')).toBeInTheDocument();
    expect(within(row).getByText('Smart trainer')).toBeInTheDocument();
    act(() => {
      for (let t = 1000; t <= 30_000; t += 1000) bluetooth.pump(t);
    });
    expect(within(row).getByText('100 W · 90 rpm')).toBeInTheDocument();
  });

  it('hides watts for a bike without a meter', async () => {
    const { bluetooth, store } = fakeStore();
    mount(store, { showWatts: false });
    await act(() => store.connect('trainer'));
    act(() => bluetooth.pump(1000));
    expect(within(screen.getByTestId('device-trainer')).getByText('90 rpm')).toBeInTheDocument();
  });

  it('offers only the heart rate strap for a plain knob bike', () => {
    const { store } = fakeStore();
    mount(store, { showTrainer: false });
    expect(screen.queryByTestId('device-trainer')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Connect strap' })).toBeInTheDocument();
  });

  it('shows heart rate and missing skin contact', async () => {
    const hr = new FakeHrSensor({ bpm: () => 131 });
    const { bluetooth, store } = fakeStore({ hr });
    mount(store);
    const row = screen.getByTestId('device-hr');
    fireEvent.click(within(row).getByRole('button', { name: 'Connect strap' }));
    await waitFor(() => expect(row).toHaveAttribute('data-status', 'connected'));
    act(() => bluetooth.pump(1000));
    expect(within(row).getByText('131 bpm')).toBeInTheDocument();
    hr.contact = 'none';
    act(() => bluetooth.pump(2000));
    expect(within(row).getByText('No skin contact')).toBeInTheDocument();
  });

  it('disconnects on request', async () => {
    const { store } = fakeStore();
    mount(store);
    await act(() => store.connect('trainer'));
    const row = screen.getByTestId('device-trainer');
    fireEvent.click(within(row).getByRole('button', { name: 'Disconnect' }));
    expect(row).toHaveAttribute('data-status', 'disconnected');
    expect(within(row).getByText('Disconnected')).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: 'Connect trainer' })).toBeInTheDocument();
  });

  it('after a lost link offers Reconnect and Choose another', async () => {
    const { bluetooth, store } = fakeStore();
    mount(store);
    await act(() => store.connect('trainer'));
    const row = screen.getByTestId('device-trainer');
    act(() => bluetooth.dropLink('trainer', { stayAway: true }));
    expect(within(row).getByText('Signal lost, reconnecting…')).toBeInTheDocument();
    await waitFor(() => expect(row).toHaveAttribute('data-status', 'disconnected'));
    expect(
      within(row).getByText('Connection lost. Check that the device is on and nearby.'),
    ).toBeInTheDocument();
    bluetooth.restoreLink('trainer');
    fireEvent.click(within(row).getByRole('button', { name: 'Reconnect' }));
    await waitFor(() => expect(row).toHaveAttribute('data-status', 'connected'));
    act(() => bluetooth.dropLink('trainer', { stayAway: true }));
    await waitFor(() => expect(row).toHaveAttribute('data-status', 'disconnected'));
    bluetooth.restoreLink('trainer');
    fireEvent.click(within(row).getByRole('button', { name: 'Choose another' }));
    await waitFor(() => expect(row).toHaveAttribute('data-status', 'connected'));
  });

  it('explains a failed connection; the compact variant keeps the row short', async () => {
    const { bluetooth, store } = fakeStore();
    bluetooth.failConnects('hr', 1);
    mount(store, { variant: 'compact' });
    const row = screen.getByTestId('device-hr');
    expect(row.textContent).not.toContain('Not connected');
    fireEvent.click(within(row).getByRole('button', { name: 'Connect strap' }));
    await waitFor(() =>
      expect(
        within(row).getByText('Could not connect. Turn the device on and try again.'),
      ).toBeInTheDocument(),
    );
    expect(screen.queryByText('Device not on the list?')).not.toBeInTheDocument();
  });

  it('a closed chooser leaves everything as it was', async () => {
    const { bluetooth, store } = fakeStore();
    bluetooth.chooser = 'cancel';
    mount(store);
    fireEvent.click(screen.getByRole('button', { name: 'Connect trainer' }));
    await act(async () => {});
    expect(screen.getByTestId('device-trainer')).toHaveAttribute('data-status', 'none');
  });

  it('shows the help list and an adapter warning when the engine reports no adapter', async () => {
    const { bluetooth, store } = fakeStore();
    bluetooth.available = false;
    mount(store);
    expect(await screen.findByTestId('devices-adapter')).toHaveTextContent(
      'Bluetooth may be off on this device.',
    );
    expect(screen.getByText('Device not on the list?')).toBeInTheDocument();
    expect(screen.getByText(/needs Bluetooth FTMS/)).toBeInTheDocument();
  });

  it('explains an unsupported browser instead of offering buttons (Polish)', () => {
    setLang('pl');
    const store = createDeviceStore({
      support: { supported: false, reason: 'ios' },
      wakeLock: noWakeLock,
    });
    mount(store);
    expect(screen.getByTestId('devices-unsupported')).toHaveTextContent(
      'Przeglądarki na iPhonie i iPadzie nie obsługują Bluetooth.',
    );
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('uses the shared store when none is provided (jsdom: unsupported)', () => {
    render(<DevicesPanel variant="full" showTrainer showWatts />);
    expect(screen.getByTestId('devices-unsupported')).toBeInTheDocument();
  });

  it('renders nothing in the compact variant when Bluetooth is unsupported', () => {
    const { container } = render(<DevicesPanel variant="compact" showTrainer showWatts />);
    expect(container).toBeEmptyDOMElement();
  });
});
