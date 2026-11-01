import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterEach } from 'vitest';

// The full suite runs ~100 jsdom files in parallel; the 1 s default makes findBy*/waitFor flaky under load.
configure({ asyncUtilTimeout: 10000 });

afterEach(cleanup);

// Node 24's undici rejects the jsdom AbortSignal ("Expected signal to be an instance of AbortSignal"),
// which breaks react-router navigations and fetch calls in tests. Drop the signal; tests never abort.
function withoutSignal(init?: RequestInit): RequestInit | undefined {
  if (!init || !('signal' in init)) return init;
  const rest = { ...init };
  delete rest.signal;
  return rest;
}
const NativeRequest = globalThis.Request;
globalThis.Request = class extends NativeRequest {
  constructor(input: RequestInfo | URL, init?: RequestInit) {
    super(input, withoutSignal(init));
  }
} as typeof Request;
const nativeFetch = globalThis.fetch;
globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) =>
  nativeFetch(input, withoutSignal(init))) as typeof fetch;
