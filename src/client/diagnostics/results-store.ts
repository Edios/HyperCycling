import { create } from 'zustand';
import type { TestResult } from './recommendation';

interface ResultsStore {
  /** Results of the last performance test in this page session. */
  results: TestResult[];
  setResults(results: TestResult[]): void;
}

export const useTestResults = create<ResultsStore>((set) => ({
  results: [],
  setResults: (results) => set({ results }),
}));
