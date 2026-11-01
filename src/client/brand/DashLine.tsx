import styles from './brand.module.css';

/** Decorative divider of grey rectangular dashes (10x4, radius 1). Never carries meaning. */
export function DashLine({ className }: { className?: string }) {
  return (
    <div
      className={`${styles.dash}${className ? ` ${className}` : ''}`}
      aria-hidden="true"
      data-testid="dash-line"
    />
  );
}
