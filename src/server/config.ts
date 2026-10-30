export const DEFAULT_PORT = 5175;

/** Parses the PORT env value; anything that is not an integer in 1..65535 falls back to the default. */
export function parsePort(value: string | undefined): number {
  if (value === undefined || !/^\d+$/.test(value)) return DEFAULT_PORT;
  const n = Number(value);
  return n >= 1 && n <= 65535 ? n : DEFAULT_PORT;
}

/** Listen settings. Kept apart from main.ts so tests can import it without starting a server. */
export const serverConfig = {
  host: '127.0.0.1',
  port: parsePort(process.env.PORT),
} as const;
