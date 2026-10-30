/** Listen settings. Kept apart from main.ts so tests can import it without starting a server. */
export const serverConfig = {
  host: '127.0.0.1',
  port: Number(process.env.PORT ?? 5175),
} as const;
