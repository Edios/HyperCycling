# Privacy

HyperCycling keeps your data on your device. This page says what stays there and what leaves it.

## What stays on your device

Workouts, plans, history, settings, FTP, max heart rate and zones, and any API keys you enter are stored only in your browser (IndexedDB, and localStorage for small items), or, in the local build, in a file on your computer. You can export or delete it in Settings, Data.

- No accounts and no sign-in to HyperCycling.
- No analytics, advertising or tracking scripts.
- No server of ours receives your data. The website only serves the app files.
- Your heart rate and FTP are never sent anywhere, and the app does not log them.

## External services (only when you use them)

| Service    | When                                             | What it receives                                                                                                                                                                                         |
| ---------- | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Spotify    | You connect Spotify                              | Sign-in with your own Client ID (PKCE), playback commands and track links. Your browser talks to Spotify directly; tokens stay local and are left out of exports. See [Spotify setup](spotify-setup.md). |
| YouTube    | A YouTube track or background is used            | The video ID, loaded in an embedded YouTube player. Google may set its own cookies and sees your IP address, as with any YouTube embed.                                                                  |
| Deezer     | You use the song finder                          | The artist and title you typed, plus your IP address.                                                                                                                                                    |
| GetSongBPM | You add your own API key and use the song finder | The artist and title you typed, your key, and your IP address. The app links back to [GetSongBPM](https://getsongbpm.com) as their terms require.                                                        |

Each service has its own privacy policy. Nothing is sent to them until you connect or use the matching feature.

## Questions

Open an issue at https://github.com/Edios/HyperCycling/issues.
