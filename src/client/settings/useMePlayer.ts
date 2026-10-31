import { useCallback, useEffect, useState } from 'react';
import type { Player } from '../../domain/player';
import { getRepositories } from '../data/repositories';

export interface MePlayer {
  /** Undefined until loaded, and when no player is marked as "me". */
  me: Player | undefined;
  loaded: boolean;
  /** Stores the new FTP on the "me" player; resolves false when there is none or the write failed. */
  saveFtp: (ftp: number) => Promise<boolean>;
}

/** The player marked `isMe`, whose FTP the settings screen shows and edits. */
export function useMePlayer(): MePlayer {
  const [state, setState] = useState<{ me: Player | undefined; loaded: boolean }>({
    me: undefined,
    loaded: false,
  });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      let me: Player | undefined;
      try {
        const repos = await getRepositories();
        me = (await repos.players.list()).find((p) => p.isMe);
      } catch (err) {
        console.warn('Loading players failed', err);
      }
      if (!cancelled) setState({ me, loaded: true });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const saveFtp = useCallback(
    async (ftp: number): Promise<boolean> => {
      const me = state.me;
      if (!me) return false;
      const next = { ...me, ftp };
      try {
        const repos = await getRepositories();
        await repos.players.put(next);
      } catch (err) {
        console.warn('Saving FTP failed', err);
        return false;
      }
      setState({ me: next, loaded: true });
      return true;
    },
    [state.me],
  );

  return { me: state.me, loaded: state.loaded, saveFtp };
}
