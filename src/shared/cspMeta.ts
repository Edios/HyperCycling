import { PAGE_CSP } from './csp';

/**
 * Inserts the CSP `<meta>` right after the charset meta (which must stay within the first 1024
 * bytes) and before any script or stylesheet tag, because a meta CSP only governs what is parsed
 * after it. Throws when the anchor is missing: shipping a build without a CSP must not be silent.
 */
export function injectCspMeta(html: string): string {
  const anchor = /<meta\s+charset=["']?UTF-8["']?\s*\/?>/i;
  if (!anchor.test(html)) {
    throw new Error('CSP meta injection failed: <meta charset="UTF-8"> not found in index.html');
  }
  return html.replace(
    anchor,
    (charset) =>
      `${charset}\n    <meta http-equiv="Content-Security-Policy" content="${PAGE_CSP}" />`,
  );
}
