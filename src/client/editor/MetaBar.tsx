import { useState, type Dispatch } from 'react';
import type { Workout } from '../../domain/workout';
import { useT } from '../i18n';
import { Chip } from '../ui/Chip';
import type { EditorAction } from './editor-state';
import { EDITOR_TAGS } from './model';
import styles from './MetaBar.module.css';

/** Description (applied on blur or Enter) and tag chips from the allowed list. */
export function MetaBar({
  workout,
  description = workout.description,
  readOnly,
  dispatch,
}: {
  workout: Workout;
  /** Text shown in the field; differs from `workout.description` only for localized built-ins. */
  description?: string;
  readOnly: boolean;
  dispatch: Dispatch<EditorAction>;
}) {
  const t = useT();
  const [draft, setDraft] = useState(description);
  const [seen, setSeen] = useState(description);
  if (seen !== description) {
    setSeen(description);
    setDraft(description);
  }
  const commit = (): void => {
    if (draft !== workout.description) {
      dispatch({ type: 'updateMeta', patch: { description: draft } });
    }
  };
  const toggle = (tag: string): void => {
    const tags = workout.tags.includes(tag)
      ? workout.tags.filter((x) => x !== tag)
      : [...workout.tags, tag];
    dispatch({ type: 'updateMeta', patch: { tags } });
  };
  return (
    <div className={styles.meta}>
      <input
        className={styles.desc}
        aria-label={t('editor.description')}
        placeholder={t('editor.descriptionPlaceholder')}
        value={draft}
        readOnly={readOnly}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
        }}
      />
      <div className={styles.tags} role="group" aria-label={t('editor.tags')}>
        {EDITOR_TAGS.map((tag) => (
          <Chip
            key={tag}
            on={workout.tags.includes(tag)}
            disabled={readOnly}
            onClick={() => toggle(tag)}
          >
            {t(`tag.${tag}`)}
          </Chip>
        ))}
      </div>
    </div>
  );
}
