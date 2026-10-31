# User guide

Spinning Tutor runs indoor-bike workouts on a screen in front of your bike: it shows the effort to ride, the cadence, the time left and the next block, with optional beeps, on-screen cues and music. It needs no sensors: you pick an effort from 1 to 10 and, if you know your FTP, the target watts.

Two ways to run it, same app:

- **Local**: `npm start` opens `http://127.0.0.1:5175`. Data lives in `data/spinning-tutor.db` on your computer, with automatic backups before an import.
- **GitHub Pages**: the same app in the browser. Data lives in the browser's storage (IndexedDB) on that computer; use Settings, Data to export it.

Best on a 1920x1080 screen; 1280x720 is the minimum. Polish and English are built in (Settings, General).

![Plan screen](images/plan.png)

## Plans and freestyle

The top bar has **Plan**, **Freestyle**, **Players** and **Settings**.

**Plan** is the guided way. A plan gives every week two sessions: a **Progres** session that builds fitness and a **Freestyle** one for fun. Built-in plans: Back to Form, Build Form, Keep Fit, Quick Boost. Pick one in **Choose a plan** (the bars show the load of coming weeks), then optionally customize it:

- session length (stretches warm-up, cool-down and number of repeats),
- difficulty: easier -5 %, standard, harder +5 %,
- sessions per week: Progres + Freestyle, 2 x Progres, or a third Freestyle,
- start week and your FTP (for watts).

The Plan tab then shows your next session with **Ride**, a **Swap** button for an alternative, and a week-by-week list. Finishing a ride asks whether it counts toward the plan. Switching plans keeps the progress in the old one.

![Choosing a plan](images/plan-gallery.png)

**Freestyle** is the library of single workouts (about 100 built in), with filters (up to 30 min, HIIT, Zone 2, Climbs, Tests, Music, Mine) and search. Open one to go to its setup screen.

![Freestyle library](images/freestyle.png)

## Setup before a ride

![Setup screen](images/setup.png)

- **Background**: _Basic_ (large numbers on a dark or light panel), _Hyperride_ (a 3D tunnel that you ride through, needs WebGL; Settings, Training has a Low quality mode) or _YouTube video_ (paste a watch, youtu.be, Shorts or embed link; a start time such as `t=1m30s` is respected; the last ten links are remembered). If a video cannot be embedded the app falls back to Basic.
- **Screen layout**: Basic offers _Solo_ and _With players_. Hyperride and YouTube offer _Immersive_, _Column_, _Cockpit_ and _Time in the tunnel_; Cockpit and Time in the tunnel are for riding without players.
- **Who rides today**: pick up to 10 riders, or add one on the spot. With players selected, the screen shows each rider's target watts, computed from their own FTP.
- **Beeps**, **On-screen cues** and **Music** switches. Music is available when the workout has pinned tracks.

The next ride starts with the choices from the last one. Defaults live in Settings, Training.

### Players

Players screen: name (1-24 characters) and FTP (whole watts, 50-600). Mark one rider as **This is me**; that FTP is used in Settings and for FTP test results.

![Players](images/players.png)

## During a workout

![Basic layout with players](images/training-basic.png)

Press **Space** (or **Start**) to start: a 3-second countdown, then the workout. The screen shows effort (1-10 with a label and about % of FTP), cadence and position (seated or standing), time left in the block, the next block and a timeline of the whole workout. Beeps count down the end of each block and on-screen cues (for example "Stand up!") appear when a block asks for them.

| Key                | Action                                          |
| ------------------ | ----------------------------------------------- |
| Space              | start, pause, resume                            |
| Left / Right arrow | previous / next block                           |
| G                  | show or hide the players list                   |
| H                  | next layout (Hyperride and YouTube only)        |
| F                  | fullscreen                                      |
| M                  | mute beeps and music                            |
| Esc                | close quick settings, or ask to end the workout |

The control bar at the bottom hides after a few seconds without mouse or key activity and comes back on any movement. It has the same actions as the keys, plus **Quick settings** and **Menu**.

**Quick settings** change background, layout, beeps and on-screen cues without leaving the ride.

**Ending**: **Menu** or Esc asks what to do: _End and see summary_, _Leave without saving_, or _Cancel_. If you close the tab or the PC sleeps mid-ride, the next start offers **Resume** or **Discard**; the workout time is computed from the clock, so it picks up in the right block.

![End workout dialog](images/end-dialog.png)

![Hyperride with the Immersive layout](images/training-hyperride.png)

The **summary** shows time ridden and whether you completed the workout. For FTP test workouts it also proposes a new FTP.

![Summary](images/summary.png)

## Settings

![Settings](images/settings.png)

Six sections:

- **General**: language, Basic background theme (dark or light), link to this help.
- **Equipment & FTP**: what your bike shows (watts, cadence), so the training screen shows only what your bike reports, your FTP, and the FTP test guide below.
- **Training**: sounds, coach messages, effects intensity, Hyperride quality, and the default background and layout for the setup screen.
- **Zones**: the effort table. Each of the 10 levels has a %FTP (20-200, strictly increasing) and a colour; **Restore defaults** resets it.
- **Music**: Spotify connection, see [Spotify setup](spotify-setup.md).
- **Data**: export, import, storage location, recent YouTube links.

### FTP test guide

FTP is the power you can hold for about an hour. Pick a test, ride it (each has a ready workout, **Start this test**), type the measured power, and the calculator gives your FTP and saves it for the rider marked "me".

| Test                     | What to note                          | FTP                            |
| ------------------------ | ------------------------------------- | ------------------------------ |
| Ramp test (about 35 min) | best 1-minute power                   | 75 % of it                     |
| 20-minute test           | average power of the 20 minutes       | 95 % of it                     |
| 2 x 8-minute test        | average power of each 8-minute effort | 90 % of the average of the two |

![FTP test guide](images/settings-ftp.png)

### Data export and import

**Export data** downloads one JSON file with workouts, players, plans, history and settings (Spotify tokens are left out). **Import data** replaces everything with the file's contents. The file is validated first: if it is not a Spinning Tutor export, comes from a different version or has invalid data, nothing is changed and you see the reason. In the local build a database backup is written to `data/backups/` before the replace (the 10 newest are kept). Use export and import to move data between the local app and GitHub Pages.

## Editor and importing workouts

**+ New workout** in Freestyle opens the editor. Built-in workouts are read-only: press **Duplicate** to make your own copy.

![Editor](images/editor.png)

- Add blocks from the palette (warm-up, steady, intervals N x, ramp, cool-down): click to append, or drag onto the timeline.
- On the timeline drag a block's right edge to change its time (15 s steps, Shift for 5 s) and its top edge to change effort.
- The inspector sets effort or an exact %FTP, time (m:ss), cadence, seated or standing, an on-screen command, repeats and the blocks inside a repeat.
- Undo and redo, name, description and tags, then **Save**. Leaving with unsaved changes asks first.

To bring in workouts from other apps use **Import file** in Freestyle (`.zwo`, `.erg`, `.mrc`): see [Importing workouts](importing-workouts.md).

## Music

Music is pinned to workout blocks in the editor (paste a Spotify track link or a YouTube link, optionally with a start time; with Spotify connected you can search for tracks). A **fallback playlist** plays when a block has no track of its own. Turn music on in the setup screen.

- **Spotify**: plays through the Spotify app on your device. Needs Premium and an active device. See [Spotify setup](spotify-setup.md).
- **YouTube**: needs no sign-in, but the video must allow embedding.

If a track cannot play you get one warning and the workout carries on unchanged. Do not confuse a YouTube _track_ (audio under the workout) with the YouTube _background_ (video behind the numbers).
