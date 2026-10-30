import { OverlayHud, type OverlayLayoutProps } from './OverlayHud';

export function Column(props: OverlayLayoutProps) {
  return <OverlayHud kind="column" {...props} />;
}
