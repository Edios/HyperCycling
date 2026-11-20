/**
 * Can this browser talk to Bluetooth devices? Web Bluetooth exists in Chromium browsers on
 * Windows, macOS, ChromeOS and Android, behind a flag on Linux, and nowhere on Firefox, Safari or
 * any iOS browser except Bluefy (research report, section 2.1).
 */

import type { MessageKey } from '../i18n';
import type { BluetoothLike } from './web-bluetooth';

export type UnsupportedReason = 'insecure-context' | 'ios' | 'firefox' | 'safari' | 'no-api';

export type BluetoothSupport =
  { supported: true; bluetooth: BluetoothLike } | { supported: false; reason: UnsupportedReason };

export interface SupportEnv {
  bluetooth: BluetoothLike | undefined;
  userAgent: string;
  maxTouchPoints: number;
  secureContext: boolean;
}

export function currentSupportEnv(): SupportEnv {
  const nav = navigator as Navigator & { bluetooth?: BluetoothLike };
  return {
    bluetooth: nav.bluetooth,
    userAgent: nav.userAgent,
    maxTouchPoints: nav.maxTouchPoints,
    secureContext: window.isSecureContext,
  };
}

export function detectBluetoothSupport(env: SupportEnv = currentSupportEnv()): BluetoothSupport {
  // Any engine that exposes the API wins (this includes Bluefy on iOS).
  if (env.bluetooth) return { supported: true, bluetooth: env.bluetooth };
  if (!env.secureContext) return { supported: false, reason: 'insecure-context' };
  const ua = env.userAgent;
  // iPadOS reports a Mac user agent; touch support tells them apart.
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && env.maxTouchPoints > 1);
  if (ios) return { supported: false, reason: 'ios' };
  if (/Firefox\//.test(ua)) return { supported: false, reason: 'firefox' };
  if (/Safari\//.test(ua) && !/Chrome\/|Chromium\/|Edg\//.test(ua)) {
    return { supported: false, reason: 'safari' };
  }
  return { supported: false, reason: 'no-api' };
}

/** Whether a Bluetooth adapter is present; true when the engine cannot tell. */
export async function isAdapterAvailable(bluetooth: BluetoothLike): Promise<boolean> {
  if (!bluetooth.getAvailability) return true;
  try {
    return await bluetooth.getAvailability();
  } catch {
    return false;
  }
}

/** Dictionary key of the user-facing explanation for each reason. */
export const UNSUPPORTED_MESSAGE: Record<UnsupportedReason | 'no-adapter', MessageKey> = {
  'insecure-context': 'devices.unsupported.insecureContext',
  ios: 'devices.unsupported.ios',
  firefox: 'devices.unsupported.firefox',
  safari: 'devices.unsupported.safari',
  'no-api': 'devices.unsupported.noApi',
  'no-adapter': 'devices.unsupported.noAdapter',
};
