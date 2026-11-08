# Spotify setup

HyperCycling can start tracks on your Spotify at the right moment of a workout. It does not play audio itself: the music comes from the Spotify app on one of your devices. YouTube needs no setup.

You need:

- a **Spotify Premium** account (Spotify only allows Premium accounts to control playback),
- the Spotify app **open on a device, with an active device** (start any track once, then pause it),
- your own free Spotify developer app (below). The app uses the PKCE login: there is no client secret to store.

## 1. Create a Spotify app

1. Open the [Developer Dashboard](https://developer.spotify.com/dashboard) and press **Create app**. Any name and description work.
2. Under **Redirect URIs** add the address of HyperCycling, exactly as written, with the trailing slash (see the table below), and save.
3. Under "Which API/SDKs are you planning to use?" tick **Web API**.
4. The app stays in development mode, which only lets listed users log in: open **User Management** and add the email of your Spotify account.
5. Open the app **Settings** and copy the **Client ID**.

## 2. Redirect URI

The redirect URI is the address where you open the app, followed by its path.

| Where you run HyperCycling     | Redirect URI                |
| ------------------------------ | --------------------------- |
| On your computer (`npm start`) | `http://127.0.0.1:5175/`    |
| GitHub Pages                   | `https://hypercycling.app/` |

Use `127.0.0.1`, never `localhost`: Spotify rejects `http://localhost` redirects. Open the local app at `http://127.0.0.1:5175` too; Settings, Music shows a warning and disables Connect if you open it on `localhost`. If you changed the port (`PORT=...`), put that port in the URI.

Settings, Music lists the exact URIs for this build and has a **Copy** button next to each.

## 3. Connect

1. In the app open **Settings, Music**, paste the Client ID.
2. Press **Connect Spotify** and approve access. You come back to the settings page.
3. Optional: pick a **Playback device**. The default, Automatic, uses whichever device is active.

The app asks for four permissions: read playback state, modify playback state, and read your private and collaborative playlists (only to import a playlist into your song library; nothing is ever written to your playlists). If you connected before this feature, disconnect and connect again to grant the playlist permission. Since February 2026 Spotify returns the songs of a playlist only for playlists you own or collaborate on. Tokens stay in your browser (or your local database) and are not part of data exports.

## Troubleshooting

| Message                                                      | What to do                                                                                                |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| Spotify has no active device                                 | Open Spotify on a phone or computer and start any track.                                                  |
| Spotify needs a Premium account                              | Playback control is not available on free accounts.                                                       |
| Spotify is not connected                                     | Connect again in Settings, Music (the login may have expired).                                            |
| The login did not match this window / access was not granted | Try Connect again.                                                                                        |
| INVALID_CLIENT: Invalid redirect URI                         | The URI in the dashboard differs from the one in the table above (check `127.0.0.1`, port, trailing `/`). |

Music problems never pause or change the workout: you get one warning and the ride goes on.

## Dopasowanie utworów do Experience i region

„Dopasuj utwory ze Spotify" szuka utworów z `market=from_token` (kraj Twojego konta) i odrzuca te, które
Spotify oznacza jako niegrywalne u Ciebie. Aplikacja **nie prosi o zakres `user-read-private`** (ujawniałby
kraj i e-mail konta). Jeśli Spotify odrzuci zapytanie z `from_token` albo nie poda `is_playable`, utwór nie
jest uznany za grywalny: lista pokazuje „Region niezweryfikowany", a wyszukiwanie jest powtarzane bez
parametru `market`. Wtedy sprawdź na liście, czy utwór gra u Ciebie, zanim zatwierdzisz wybór.
