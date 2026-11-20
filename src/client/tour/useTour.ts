import { useCallback, useLayoutEffect, useReducer, useRef } from 'react';
import {
  createTourState,
  outcomeOnLeave,
  tourReducer,
  writeTourOutcome,
  type TourState,
} from './tour-state';

export interface Tour extends TourState {
  start: () => void;
  next: () => void;
  back: () => void;
  /** Ends the tour early; it is remembered as seen, so it does not open by itself again. */
  skip: () => void;
}

/** A tour with `count` steps whose outcome is remembered under the localStorage `key`. */
export function useTour(key: string, count: number): Tour {
  const [state, dispatch] = useReducer(tourReducer, count, createTourState);
  const ref = useRef(state);
  useLayoutEffect(() => {
    ref.current = state;
  });

  const start = useCallback(() => dispatch({ type: 'start' }), []);
  const back = useCallback(() => dispatch({ type: 'back' }), []);
  const leave = useCallback(
    (action: 'next' | 'stop') => {
      const current = ref.current;
      if (!current.running) return;
      const outcome = outcomeOnLeave(current, action);
      if (action === 'stop' || outcome === 'done') writeTourOutcome(key, outcome);
      dispatch({ type: action });
    },
    [key],
  );
  const next = useCallback(() => leave('next'), [leave]);
  const skip = useCallback(() => leave('stop'), [leave]);

  return { ...state, start, next, back, skip };
}
