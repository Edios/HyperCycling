import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { playerSchema, type Player } from '../../domain/player';
import { DashLine } from '../brand';
import { getRepositories } from '../data/repositories';
import { useSettings } from '../data/useSettings';
import { useT } from '../i18n';
import { AppBar } from '../ui/AppBar';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Field } from '../ui/Field';
import { Modal } from '../ui/Modal';
import styles from './PlayersScreen.module.css';

interface Errors {
  name?: boolean;
  ftp?: boolean;
}

type Repos = Awaited<ReturnType<typeof getRepositories>>;

/** Validates the raw form values with the domain schema; returns the player or which fields failed. */
function validate(
  id: string,
  name: string,
  ftp: string,
): { ok: true; player: Player } | { ok: false; errors: Errors } {
  const candidate = {
    id,
    name,
    ftp: ftp.trim() === '' ? Number.NaN : Number(ftp),
  };
  const r = playerSchema.safeParse(candidate);
  if (r.success) return { ok: true, player: r.data };
  const errors: Errors = {};
  for (const issue of r.error.issues) {
    if (issue.path[0] === 'name') errors.name = true;
    if (issue.path[0] === 'ftp') errors.ftp = true;
  }
  return { ok: false, errors };
}

function newId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ?? `p-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
}

function withoutMe(p: Player): Player {
  return { id: p.id, name: p.name, ftp: p.ftp };
}

interface FormProps {
  initial?: { name: string; ftp: string };
  submitLabel: string;
  onSubmit: (name: string, ftp: string) => Promise<Errors | undefined>;
  onCancel?: () => void;
  resetOnSuccess?: boolean;
  autoFocus?: boolean;
}

function PlayerForm({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
  resetOnSuccess,
  autoFocus,
}: FormProps) {
  const t = useT();
  const [name, setName] = useState(initial?.name ?? '');
  const [ftp, setFtp] = useState(initial?.ftp ?? '');
  const [errors, setErrors] = useState<Errors>({});
  const [saving, setSaving] = useState(false);
  const firstInput = useRef<HTMLInputElement>(null);
  // A ref next to the state: a second submit can arrive before React re-renders with saving=true.
  const inFlight = useRef(false);

  useEffect(() => {
    if (autoFocus) firstInput.current?.focus();
  }, [autoFocus]);

  const submit = (e: FormEvent): void => {
    e.preventDefault();
    if (inFlight.current) return;
    inFlight.current = true;
    setSaving(true);
    void (async () => {
      let result: Errors = {};
      try {
        result = (await onSubmit(name, ftp)) ?? {};
      } finally {
        inFlight.current = false;
        setSaving(false);
      }
      setErrors(result);
      if (!result.name && !result.ftp && resetOnSuccess) {
        setName('');
        setFtp('');
      }
    })();
  };

  return (
    <form
      className={styles.form}
      onSubmit={submit}
      noValidate
      onKeyDown={(e) => {
        if (e.key === 'Escape' && onCancel) {
          e.stopPropagation();
          onCancel();
        }
      }}
    >
      <Field label={t('players.name')} {...(errors.name ? { error: t('players.nameError') } : {})}>
        {(id) => (
          <input
            id={id}
            ref={firstInput}
            value={name}
            maxLength={24}
            aria-invalid={errors.name ? true : undefined}
            onChange={(e) => setName(e.target.value)}
          />
        )}
      </Field>
      <Field label={t('players.ftp')} {...(errors.ftp ? { error: t('players.ftpError') } : {})}>
        {(id) => (
          <input
            id={id}
            type="number"
            inputMode="numeric"
            value={ftp}
            aria-invalid={errors.ftp ? true : undefined}
            onChange={(e) => setFtp(e.target.value)}
          />
        )}
      </Field>
      <div className={styles.formActions}>
        <Button type="submit" variant="primary" disabled={saving}>
          {submitLabel}
        </Button>
        {onCancel && <Button onClick={onCancel}>{t('players.cancel')}</Button>}
      </div>
    </form>
  );
}

async function fetchPlayers(): Promise<Player[]> {
  try {
    const repos = await getRepositories();
    const list = (await repos.players.list()).sort((a, b) => a.name.localeCompare(b.name));
    // Repair data with more than one "me": keep the first and persist the fix.
    const extra = new Set(
      list
        .filter((p) => p.isMe)
        .slice(1)
        .map((p) => p.id),
    );
    for (const p of list) {
      if (extra.has(p.id)) await repos.players.put(withoutMe(p));
    }
    return list.map((p) => (extra.has(p.id) ? withoutMe(p) : p));
  } catch (err) {
    console.warn('Loading players failed', err);
    return [];
  }
}

export function PlayersScreen() {
  const t = useT();
  const { settings, updateSettings } = useSettings();
  const [players, setPlayers] = useState<Player[] | undefined>();
  const [editingId, setEditingId] = useState<string | undefined>();
  const [deleting, setDeleting] = useState<Player | undefined>();
  const [failed, setFailed] = useState(false);
  const requestId = useRef(0);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const editButtons = useRef(new Map<string, HTMLButtonElement>());
  const returnFocusTo = useRef<string | undefined>(undefined);

  /** Applies a list only if no newer load started since (stale results are dropped). */
  const reload = useCallback(async () => {
    const id = ++requestId.current;
    const list = await fetchPlayers();
    if (id === requestId.current) setPlayers(list);
  }, []);

  useEffect(() => {
    void reload();
    return () => {
      requestId.current += 1; // ignore results after unmount
    };
  }, [reload]);

  useEffect(() => {
    if (editingId === undefined && returnFocusTo.current) {
      editButtons.current.get(returnFocusTo.current)?.focus();
      returnFocusTo.current = undefined;
    }
  }, [editingId]);

  const closeEdit = (id: string): void => {
    returnFocusTo.current = id;
    setEditingId(undefined);
  };

  /** Runs storage writes one after another (so they land in click order), then refreshes the list. */
  const persist = (write: (repos: Repos) => Promise<void>): Promise<void> => {
    const run = async (): Promise<void> => {
      try {
        const repos = await getRepositories();
        await write(repos);
        setFailed(false);
      } catch (err) {
        console.warn('Saving players failed', err);
        setFailed(true);
      }
      await reload();
    };
    const next = queue.current.then(run);
    queue.current = next;
    return next;
  };

  const add = async (name: string, ftp: string): Promise<Errors | undefined> => {
    const v = validate(newId(), name, ftp);
    if (!v.ok) return v.errors;
    await persist((repos) => repos.players.put(v.player));
    return undefined;
  };

  const save = async (p: Player, name: string, ftp: string): Promise<Errors | undefined> => {
    const v = validate(p.id, name, ftp);
    if (!v.ok) return v.errors;
    await persist(async (repos) => {
      const current = await repos.players.get(p.id); // re-read: never write a stale isMe
      if (current) await repos.players.put({ ...current, name: v.player.name, ftp: v.player.ftp });
    });
    closeEdit(p.id);
    return undefined;
  };

  const setMe = (target: Player): Promise<void> =>
    persist(async (repos) => {
      const all = await repos.players.list();
      const current = all.find((p) => p.id === target.id);
      if (!current) return;
      await repos.players.put({ ...current, isMe: true }); // new me first, so there is never a gap
      for (const p of all) {
        if (p.id !== target.id && p.isMe) await repos.players.put(withoutMe(p));
      }
    });

  const remove = async (p: Player): Promise<void> => {
    setDeleting(undefined);
    await persist((repos) => repos.players.remove(p.id));
    const last = settings.lastSession;
    if (last?.playerIds.includes(p.id)) {
      try {
        await updateSettings({
          lastSession: { ...last, playerIds: last.playerIds.filter((id) => id !== p.id) },
        });
      } catch (err) {
        console.warn('Updating the last session failed', err);
        setFailed(true);
      }
    }
  };

  return (
    <div data-testid="players-screen" className={styles.page}>
      <AppBar />
      <main className={styles.main}>
        <div className={styles.head}>
          <h1>{t('players.title')}</h1>
          <Button
            variant="primary"
            onClick={() =>
              document.getElementById('add-player-form')?.querySelector('input')?.focus()
            }
          >
            {t('players.add')}
          </Button>
        </div>
        <DashLine />
        <p className={styles.sub}>{t('players.subtitle')}</p>
        {!settings.equipment.showsWatts && (
          <p className={styles.note}>{t('players.wattsHidden')}</p>
        )}
        {failed && (
          <p role="alert" className={styles.err}>
            {t('players.saveFailed')}
          </p>
        )}

        <Card className={styles.list}>
          {players?.length === 0 && <p className={styles.empty}>{t('players.empty')}</p>}
          <ul>
            {players?.map((p) =>
              editingId === p.id ? (
                <li key={p.id} data-testid="player-edit" className={styles.editRow}>
                  <PlayerForm
                    initial={{ name: p.name, ftp: String(p.ftp) }}
                    submitLabel={t('players.save')}
                    onSubmit={(n, f) => save(p, n, f)}
                    onCancel={() => closeEdit(p.id)}
                    autoFocus
                  />
                </li>
              ) : (
                <li key={p.id} data-testid="player-row" className={styles.row}>
                  <span className={styles.name}>{p.name}</span>
                  <span className={styles.ftp}>
                    <b>{p.ftp}</b> <small>{t('players.ftpUnit')}</small>
                  </span>
                  <Button
                    className={styles.me}
                    aria-pressed={p.isMe === true}
                    aria-label={t('players.meFor', { name: p.name })}
                    onClick={() => {
                      if (!p.isMe) void setMe(p);
                    }}
                  >
                    {p.isMe ? '●' : '○'} {t('players.me')}
                  </Button>
                  <span className={styles.actions}>
                    <Button
                      ref={(el) => {
                        if (el) editButtons.current.set(p.id, el);
                        else editButtons.current.delete(p.id);
                      }}
                      aria-label={t('players.editFor', { name: p.name })}
                      onClick={() => setEditingId(p.id)}
                    >
                      {t('players.edit')}
                    </Button>
                    <Button
                      aria-label={t('players.deleteFor', { name: p.name })}
                      onClick={() => setDeleting(p)}
                    >
                      {t('players.deleteLabel')}
                    </Button>
                  </span>
                </li>
              ),
            )}
          </ul>
        </Card>

        <Card className={styles.addCard}>
          <div id="add-player-form" data-testid="add-player-form">
            <PlayerForm submitLabel={t('players.addSubmit')} onSubmit={add} resetOnSuccess />
          </div>
        </Card>
      </main>

      {deleting && (
        <Modal title={t('players.deleteTitle')} onClose={() => setDeleting(undefined)}>
          <p>{t('players.deleteBody', { name: deleting.name })}</p>
          <div className={styles.formActions}>
            <Button onClick={() => setDeleting(undefined)}>{t('players.cancel')}</Button>
            <Button variant="primary" onClick={() => void remove(deleting)}>
              {t('players.deleteLabel')}
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
