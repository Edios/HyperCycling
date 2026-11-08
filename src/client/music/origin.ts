/**
 * YouTube refuses to embed most videos (player error 150) when the page's address is an IP
 * (127.0.0.1, 192.168.x.x, [::1]); on `localhost` and on a domain the same videos play. We do not
 * work around that (no fake Referer): the app says so and prefers Spotify there.
 */
const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;

/** True for an IP-address host name, as `location.hostname` gives it. */
export function isIpHost(hostname: string): boolean {
  return IPV4.test(hostname) || hostname.startsWith('[') || hostname.includes(':');
}

/** The host name when the app runs from an IP address (YouTube will not play), else undefined. */
export function ipOriginHost(
  loc: Pick<Location, 'hostname'> | undefined = typeof window === 'undefined'
    ? undefined
    : window.location,
): string | undefined {
  const host = loc?.hostname;
  return host && isIpHost(host) ? host : undefined;
}
