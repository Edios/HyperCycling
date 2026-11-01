import { Classic } from './Classic';
import type { BasicLayoutProps } from './types';

export function BasicPlayers(props: BasicLayoutProps) {
  return <Classic {...props} withPlayers />;
}
