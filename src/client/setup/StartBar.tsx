import { useEffect, useRef, useState } from 'react';
import { useT } from '../i18n';
import { Button } from '../ui/Button';
import { Icon, type IconName } from '../ui/Icon';
import styles from './StartBar.module.css';

interface Shortcut {
  label: string;
  icon: IconName;
  /** Accessible name when the visible text is not enough. */
  ariaLabel?: string;
  /** A toggle shortcut reports its state; an opener leaves this out. */
  pressed?: boolean;
  disabled?: boolean;
  onClick: () => void;
  testId: string;
}

interface Props {
  /** `shortcuts`: chips above Start (Plan, Freestyle). `status`: one status line and Start (Experience). */
  variant: 'shortcuts' | 'status';
  music: Shortcut;
  layout?: Shortcut;
  more?: Shortcut;
  /** The one line above Start in the `status` variant. */
  status?: string;
  /** Why Start is off, with the way out; shown above Start. */
  notice?: { text: string; action: string; onAction: () => void };
  disabled: boolean;
  onStart: () => void;
}

function Chip({ s }: { s: Shortcut }) {
  return (
    <button
      type="button"
      className={`${styles.chip} ${s.pressed ? styles.chipOn : ''}`}
      {...(s.pressed !== undefined ? { 'aria-pressed': s.pressed } : {})}
      {...(s.ariaLabel ? { 'aria-label': s.ariaLabel } : {})}
      disabled={s.disabled === true}
      onClick={s.onClick}
      data-testid={s.testId}
    >
      <Icon name={s.icon} size={18} />
      <span>{s.label}</span>
    </button>
  );
}

const TEXT_TYPES = new Set(['text', 'url', 'number', 'search', 'email', 'tel', 'password']);

function isTextField(el: Element | null): boolean {
  return (
    el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && TEXT_TYPES.has(el.type))
  );
}

/**
 * True while a text field has focus on a short viewport (an on-screen keyboard, a landscape phone):
 * the bar steps aside there, or it would sit on the field being typed into.
 */
function useTypingOnShortViewport(): boolean {
  const [typing, setTyping] = useState(false);
  useEffect(() => {
    const update = (): void => {
      const height = window.visualViewport?.height ?? window.innerHeight;
      setTyping(isTextField(document.activeElement) && height < 520);
    };
    const afterBlur = (): void => void window.setTimeout(update, 0);
    document.addEventListener('focusin', update);
    document.addEventListener('focusout', afterBlur);
    window.visualViewport?.addEventListener('resize', update);
    update();
    return () => {
      document.removeEventListener('focusin', update);
      document.removeEventListener('focusout', afterBlur);
      window.visualViewport?.removeEventListener('resize', update);
    };
  }, []);
  return typing;
}

/**
 * Keeps a focused control clear of the bar (WCAG 2.4.11): the page scrolls with a bottom padding
 * as tall as the bar, and a control that still ends up under it is scrolled up above it.
 */
function useKeepFocusClear(bar: React.RefObject<HTMLDivElement | null>, away: boolean): void {
  useEffect(() => {
    const el = bar.current;
    if (!el || away) return;
    const root = document.documentElement;
    const pad = (): void => {
      root.style.scrollPaddingBottom = `${el.offsetHeight + 8}px`;
    };
    pad();
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(pad);
    observer?.observe(el);
    const onFocus = (e: FocusEvent): void => {
      const target = e.target;
      if (!(target instanceof HTMLElement) || el.contains(target)) return;
      const rect = target.getBoundingClientRect();
      const limit = el.getBoundingClientRect().top - 8;
      if (rect.bottom > limit && rect.top < limit) {
        window.scrollBy(0, Math.max(0, Math.min(rect.bottom - limit, rect.top)));
      }
    };
    document.addEventListener('focusin', onFocus);
    return () => {
      document.removeEventListener('focusin', onFocus);
      observer?.disconnect();
      root.style.scrollPaddingBottom = '';
    };
  }, [bar, away]);
}

/**
 * The sticky bottom bar of the ride setup: optional shortcuts (music on/off, screen layout, more
 * settings) over a big Start in the mode's colour. It keeps clear of the phone's home indicator.
 */
export function StartBar({
  variant,
  music,
  layout,
  more,
  status,
  notice,
  disabled,
  onStart,
}: Props) {
  const t = useT();
  const wrap = useRef<HTMLDivElement>(null);
  const typing = useTypingOnShortViewport();
  useKeepFocusClear(wrap, typing);
  return (
    <div
      ref={wrap}
      className={`${styles.wrap} ${typing ? styles.away : ''}`}
      data-testid="start-bar"
    >
      <div className={styles.bar} role="group" aria-label={t('setup.startBar')}>
        {notice && (
          <p className={styles.notice} role="status" data-testid="start-notice">
            <span>{notice.text}</span>
            <button type="button" className={styles.noticeAction} onClick={notice.onAction}>
              {notice.action}
            </button>
          </p>
        )}
        {variant === 'shortcuts' ? (
          <div className={styles.chips}>
            <Chip s={music} />
            {layout && <Chip s={layout} />}
            {more && <Chip s={more} />}
          </div>
        ) : (
          status && (
            <p className={styles.status} data-testid="start-status">
              <Icon name="music" size={16} />
              <span>{status}</span>
            </p>
          )
        )}
        <Button
          variant="primary"
          size="big"
          className={styles.start}
          onClick={onStart}
          disabled={disabled}
          data-testid="start"
        >
          <Icon name="play" size={22} />
          {t('setup.start')}
        </Button>
      </div>
    </div>
  );
}
