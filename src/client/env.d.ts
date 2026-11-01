interface ImportMetaEnv {
  /** package.json version, injected by vite.config.ts. */
  readonly VITE_APP_VERSION?: string;
  /** Set by the e2e builds (`VITE_E2E=1`). */
  readonly VITE_E2E?: string;
}
