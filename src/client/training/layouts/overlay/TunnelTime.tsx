import { OverlayHud, type OverlayLayoutProps } from './OverlayHud';

export function TunnelTime(props: OverlayLayoutProps) {
  return <OverlayHud kind="tunnel" {...props} />;
}
