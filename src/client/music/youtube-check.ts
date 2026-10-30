export interface YoutubeCheck {
  /** `ok`: embeddable. `blocked`: the owner disallows embedding. `missing`: private or deleted. */
  status: 'ok' | 'blocked' | 'missing' | 'unknown';
  title?: string;
  author?: string;
}

/**
 * Asks YouTube's oEmbed endpoint whether a video can be embedded (401 = embedding disabled,
 * 404 = not found) and returns its title. Network trouble or an odd answer gives `unknown`:
 * nothing is marked then, because the IFrame player reports the truth at playback time.
 */
export async function checkYoutubeEmbeddable(
  videoId: string,
  doFetch: typeof fetch = (...a) => fetch(...a),
): Promise<YoutubeCheck> {
  const target = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
  try {
    const res = await doFetch(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(target)}&format=json`,
    );
    if (res.status === 401 || res.status === 403) return { status: 'blocked' };
    if (res.status === 404) return { status: 'missing' };
    if (!res.ok) return { status: 'unknown' };
    const body = (await res.json()) as { title?: unknown; author_name?: unknown };
    return {
      status: 'ok',
      ...(typeof body.title === 'string' && body.title ? { title: body.title } : {}),
      ...(typeof body.author_name === 'string' && body.author_name
        ? { author: body.author_name }
        : {}),
    };
  } catch {
    return { status: 'unknown' };
  }
}
