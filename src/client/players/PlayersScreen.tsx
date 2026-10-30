import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { playerSchema, type Player } from '../../domain/player';
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

/** Validates the raw form values with the domain schema; returns the player or which fields failed. */
function validate(
  id: string,
  name: string,
  ftp: string,
  isMe: boolean | undefined,
): { ok: true; player: Player } | { ok: false; errors: Errors } {
  const candidate = {
    id,
    name,
    ftp: ftp.trim() === '' ? Number.NaN : Number(ftp),
    ...(isMe ? { isMe: true } : {}),
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

interface FormProps {
  idPrefix?: string;
  initial?: { name: string; ftp: string };
  submitLabel: string;
  onSubmit: (name: string, ftp: string) => Errors | Promise<Errors | undefined> | undefined;
  onCancel?: () => void;
  resetOnSuccess?: boolean;
}

function PlayerForm({ initial, submitLabel, onSubmit, onCancel, resetOnSuccess }: FormProps) {
  const t = useT();
  const [name, setName] = useState(initial?.name ?? '');
  const [ftp, setFtp] = useState(initial?.ftp ?? '');
  const [errors, setErrors] = useState<Errors>({});

  const submit = (e: FormEvent): void => {
    e.preventDefault();
    void (async () => {
      const result = (await onSubmit(name, ftp)) ?? {};
      setErrors(result);
      if (!result.name && !result.ftp && resetOnSuccess) {
        setName('');
        setFtp('');
      }
    })();
  };

  return (
    <form className={styles.form} onSubmit={submit} noValidate>
      <Field label={t('players.name')} {...(errors.name ? { error: t('players.nameError') } : {})}>
        {(id) => (
          <input
            id={id}
            value={name}
            maxLength={64}
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
        <Button type="submit" variant="primary">
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
    const list = await repos.players.list();
    return list.sort((a, b) => a.name.localeCompare(b.name));
  } catch (err) {
    console.warn('Loading players failed', err);
    return [];
  }
}

export function PlayersScreen() {
  const t = useT();
  const { settings } = useSettings();
  const [players, setPlayers] = useState<Player[] | undefined>();
  const [editingId, setEditingId] = useState<string | undefined>();
  const [deleting, setDeleting] = useState<Player | undefined>();
  const [failed, setFailed] = useState(false);

  const reload = useCallback(async () => {
    setPlayers(await fetchPlayers());
  }, []);

  useEffect(() => {
    let live = true;
    void fetchPlayers().then((list) => {
      if (live) setPlayers(list);
    });
    return () => {
      live = false;
    };
  }, []);

  /** Runs a storage write, then refreshes the list; shows a message if it throws. */
  const persist = async (
    write: (repos: Awaited<ReturnType<typeof getRepositories>>) => Promise<void>,
  ) => {
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

  const add = async (name: string, ftp: string): Promise<Errors | undefined> => {
    const v = validate(newId(), name, ftp, false);
    if (!v.ok) return v.errors;
    await persist((repos) => repos.players.put(v.player));
    return undefined;
  };

  const save = async (p: Player, name: string, ftp: string): Promise<Errors | undefined> => {
    const v = validate(p.id, name, ftp, p.isMe);
    if (!v.ok) return v.errors;
    await persist((repos) => repos.players.put(v.player));
    setEditingId(undefined);
    return undefined;
  };

  const setMe = async (target: Player): Promise<void> => {
    await persist(async (repos) => {
      for (const p of players ?? []) {
        if (p.id === target.id) await repos.players.put({ ...p, isMe: true });
        else if (p.isMe) {
          const { isMe: _drop, ...rest } = p;
          void _drop;
          await repos.players.put(rest);
        }
      }
    });
  };

  const remove = async (p: Player): Promise<void> => {
    setDeleting(undefined);
    await persist((repos) => repos.players.remove(p.id));
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
                    onCancel={() => setEditingId(undefined)}
                  />
                </li>
              ) : (
                <li key={p.id} data-testid="player-row" className={styles.row}>
                  <span className={styles.name}>{p.name}</span>
                  <span className={styles.ftp}>
                    <b>{p.ftp}</b> <small>{t('players.ftpUnit')}</small>
                  </span>
                  <label className={styles.me}>
                    <input
                      type="radio"
                      name="player-me"
                      aria-label={t('players.meFor', { name: p.name })}
                      checked={p.isMe === true}
                      onChange={() => void setMe(p)}
                    />
                    <span>{t('players.me')}</span>
                  </label>
                  <span className={styles.actions}>
                    <Button
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
