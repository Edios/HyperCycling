import { useDraggable } from '@dnd-kit/core';
import { useT, type MessageKey } from '../i18n';
import type { NewBlockKind } from './editor-state';
import styles from './Palette.module.css';

export const PALETTE_PREFIX = 'palette:';

const ITEMS: { kind: NewBlockKind; icon: string; label: MessageKey }[] = [
  { kind: 'warmup', icon: '↗', label: 'editor.palette.warmup' },
  { kind: 'steady', icon: '▬', label: 'editor.palette.steady' },
  { kind: 'interval', icon: '⟳', label: 'editor.palette.interval' },
  { kind: 'ramp', icon: '⟋', label: 'editor.palette.ramp' },
  { kind: 'cooldown', icon: '↘', label: 'editor.palette.cooldown' },
];

function PaletteItem({
  kind,
  icon,
  label,
  disabled,
  onAdd,
}: {
  kind: NewBlockKind;
  icon: string;
  label: string;
  disabled: boolean;
  onAdd: (kind: NewBlockKind) => void;
}) {
  const { setNodeRef, listeners, transform, isDragging } = useDraggable({
    id: `${PALETTE_PREFIX}${kind}`,
    disabled,
  });
  return (
    <button
      ref={setNodeRef}
      type="button"
      data-testid={`palette-${kind}`}
      className={styles.item}
      disabled={disabled}
      style={{
        transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
        zIndex: isDragging ? 5 : undefined,
        opacity: isDragging ? 0.8 : 1,
      }}
      onClick={() => onAdd(kind)}
      {...listeners}
    >
      <span aria-hidden="true">{icon}</span> {label}
    </button>
  );
}

/** The five block types; click adds at the end, dragging onto the timeline inserts. */
export function Palette({
  readOnly,
  onAdd,
}: {
  readOnly: boolean;
  onAdd: (kind: NewBlockKind) => void;
}) {
  const t = useT();
  return (
    <nav className={styles.palette} aria-label={t('editor.addBlock')}>
      <h2 className={styles.title}>{t('editor.addBlock')}</h2>
      {ITEMS.map((i) => (
        <PaletteItem
          key={i.kind}
          kind={i.kind}
          icon={i.icon}
          label={t(i.label)}
          disabled={readOnly}
          onAdd={onAdd}
        />
      ))}
      <p className={styles.hint}>{t('editor.paletteHint')}</p>
    </nav>
  );
}
