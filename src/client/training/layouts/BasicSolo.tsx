import { Classic } from './Classic';
import type { BasicLayoutProps } from './types';

export function BasicSolo(props: BasicLayoutProps) {
  return <Classic {...props} withPlayers={false} />;
}
