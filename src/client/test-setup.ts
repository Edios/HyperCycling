import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterEach } from 'vitest';

// The full suite runs ~100 jsdom files in parallel; the 1 s default makes findBy*/waitFor flaky under load.
configure({ asyncUtilTimeout: 4000 });

afterEach(cleanup);
