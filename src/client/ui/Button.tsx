import type { ComponentPropsWithRef } from 'react';
import styles from './Button.module.css';

export interface ButtonProps extends ComponentPropsWithRef<'button'> {
  /** `text`: a secondary action without a frame (brand §5.3: frames only for input fields). */
  variant?: 'default' | 'primary' | 'text';
  size?: 'normal' | 'big';
}

export function Button({
  variant = 'default',
  size = 'normal',
  className,
  type = 'button',
  ...rest
}: ButtonProps) {
  const cls = [
    styles.btn,
    variant === 'primary' ? styles.pri : variant === 'text' ? styles.text : '',
    size === 'big' ? styles.big : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');
  return <button type={type} className={cls} {...rest} />;
}
