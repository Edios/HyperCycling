# Importing workouts

Spinning Tutor imports `.zwo`, `.erg` and `.mrc` files. Open **Freestyle**, press **Import file**, drop or choose a file (at most 2 MB). The app shows what it understood and any notes, then opens the workout in the editor where you can fix it and save it under **Mine**.

## What a .zwo file is

A `.zwo` file is a small XML document used by Zwift. Power is written as a **fraction of FTP**: `0.75` means 75 % of FTP. Times are in seconds.

```xml
<workout_file>
  <name>Sweet spot 2x10</name>
  <description>Two long efforts just under threshold.</description>
  <workout>
    <Warmup Duration="600" PowerLow="0.45" PowerHigh="0.75"/>
    <IntervalsT Repeat="2" OnDuration="600" OnPower="0.90" OffDuration="300" OffPower="0.55"/>
    <SteadyState Duration="300" Power="0.60" Cadence="90">
      <textevent timeoffset="0" message="Spin easy"/>
    </SteadyState>
    <FreeRide Duration="120"/>
    <Cooldown Duration="300" PowerLow="0.70" PowerHigh="0.40"/>
  </workout>
</workout_file>
```

| Element                      | Meaning                                 | Imported as                                                                    |
| ---------------------------- | --------------------------------------- | ------------------------------------------------------------------------------ |
| `SteadyState`                | constant power (`Power`)                | steady block                                                                   |
| `Warmup`, `Cooldown`, `Ramp` | linear change `PowerLow` to `PowerHigh` | ramp block (steady if both ends are equal)                                     |
| `IntervalsT`                 | `Repeat` times on/off                   | repeat of two steady blocks (`OnDuration`/`OnPower`, `OffDuration`/`OffPower`) |
| `FreeRide`                   | ride as you like                        | steady block at 60 % FTP, labelled "Free ride"                                 |
| `MaxEffort`                  | all out                                 | steady block at effort 10                                                      |
| `textevent` inside a block   | on-screen message                       | the first one in a block becomes its on-screen cue                             |
| `Cadence`, `CadenceResting`  | target rpm                              | cadence of the block / of the off part                                         |

`name` and `description` are read; other header fields (author, tags and so on) are ignored.

## .erg and .mrc

Both are text files with a `[COURSE HEADER]` and a `[COURSE DATA]` section: pairs of `minutes  value`. Consecutive points become a steady block (equal values) or a ramp (different values).

- `.mrc` values are **percent of FTP**.
- `.erg` values are **watts**. Spinning Tutor needs an FTP to convert them: it uses the `FTP=` line in the header, or asks you for one in the import dialog.

## How power maps to the 1-10 effort scale

Every imported block keeps its exact %FTP and also gets the nearest effort level (a tie goes to the higher level), so the workout works for riders with and without a power display. Default table:

| Level | 1   | 2   | 3   | 4   | 5   | 6   | 7   | 8   | 9   | 10  |
| ----- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| % FTP | 45  | 55  | 62  | 70  | 78  | 85  | 92  | 100 | 112 | 130 |

Watts shown on screen are `round(FTP x %FTP / 100)`; the exact imported %FTP wins over the table. You can change the table in Settings, Zones.

## Limits and what gets skipped

The importer never crashes on a well-formed file; it drops what it cannot use and lists it as a note.

- A block with zero length, or a missing duration or power, is skipped.
- Power above 3.0 in a `.zwo` looks like watts, not a fraction of FTP: the block is skipped.
- Unknown XML elements are skipped with a note.
- Out-of-range values are clamped: intensity 20-200 % FTP, cadence 30-150 rpm, one block at most 4 hours, repeats at most 50.
- At most 2000 blocks. Files with a `DOCTYPE` or entity declarations, malformed XML, or no `<workout_file>` root are rejected with a reason.
- The workout is imported as Freestyle. Music cues are not part of these formats.

## Where to find workouts

Open-source examples you can download and try:

- [robiningelbrecht/zwift-workouts](https://github.com/robiningelbrecht/zwift-workouts): a large collection of `.zwo` files (MIT).
- [breiko83/zwo-editor](https://github.com/breiko83/zwo-editor): a browser editor that creates `.zwo` files (MIT).
- [tare/zwog](https://github.com/tare/zwog): generates `.zwo` files from a text description (BSD-3-Clause).

Check the licence of any file you download before sharing it. Spinning Tutor itself ships only original workouts.
