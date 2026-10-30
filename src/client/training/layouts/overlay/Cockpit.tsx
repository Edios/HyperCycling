import { OverlayHud, type OverlayLayoutProps } from './OverlayHud';

export function Cockpit(props: OverlayLayoutProps) {
  return <OverlayHud kind="cockpit" {...props} />;
}
