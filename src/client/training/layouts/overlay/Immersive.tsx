import { OverlayHud, type OverlayLayoutProps } from './OverlayHud';

export function Immersive(props: OverlayLayoutProps) {
  return <OverlayHud kind="immersive" {...props} />;
}
