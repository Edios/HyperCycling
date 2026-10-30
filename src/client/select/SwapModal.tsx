import type { Workout } from '../../domain/workout';
import { localizedText } from '../data/localized';
import { useLang, useT } from '../i18n';
import { Modal } from '../ui/Modal';
import { minutesOf, primaryTag, tagKey } from './model';
import styles from './SwapModal.module.css';

export interface SwapModalProps {
  title: string;
  options: readonly Workout[];
  onPick: (w: Workout) => void;
  onClose: () => void;
}

/** Picker of replacement workouts for the next plan session. */
export function SwapModal({ title, options, onPick, onClose }: SwapModalProps) {
  const t = useT();
  const [lang] = useLang();
  return (
    <Modal title={title} onClose={onClose}>
      <ul className={styles.list}>
        {options.map((w) => (
          <li key={w.id}>
            <button type="button" className={styles.item} onClick={() => onPick(w)}>
              <span className={styles.name}>{localizedText(w, lang).name}</span>
              <span className={styles.tag}>{t(tagKey(primaryTag(w)))}</span>
              <span className={styles.min}>
                {minutesOf(w)} {t('common.min')}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </Modal>
  );
}
