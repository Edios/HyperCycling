# Fix: Spotify track titles

Bug: NowPlaying showed the generic "Spotify" label because a pasted Spotify URL created a TrackRef with an empty title.

Editor: after pasting a Spotify link (block cue and fallback playlist) title/artist are filled
asynchronously via `lookupSpotifyTrack` (src/client/music/spotify/track-info.ts): Web API
`GET /v1/tracks/{id}` when connected, else (or on failure) Spotify oEmbed (title only, 5 s timeout).
Same stale guard as YouTube (still same id and still untitled). Failure leaves the title empty, no UI.

Runtime: `MusicProvider.describeTrack?` (optional); the Spotify provider implements it. After a
successful `play` of an untitled track the director looks the name up in the background (bounded by
CONTROL_TIMEOUT_MS, never blocks playback, stale results dropped) and calls `onPlaying` again with
the titled track, so NowPlaying updates with no UI change.

Tests: director (5), Spotify provider describeTrack (2), editor pasted link (5), TrainingScreen
NowPlaying (1). Also fixed a pre-existing unhandled rejection in Editor.test.tsx (the youtube-check
mock lacked applyYoutubeCheck). typecheck, lint and `npm test` all pass (installed with
`npm ci --ignore-scripts`, so better-sqlite3 was not built).
