# Tournament Manager

A local-first tournament manager for amateur **badminton** and **pickleball** leagues.

- One organizer, one device — built for a phone, no accounts, no login, no server.
- All tournament data is stored in the browser with IndexedDB (via Dexie).
- React + TypeScript + Vite, plain CSS, zero paid services.
- Hosted as a static site on GitHub Pages.


### What changed in 1.0.0

- Contrast-safe muted and warning colours, with Lighthouse accessibility, best-practices and SEO
  all at 1.00 on the dashboard, tournament, bracket and data screens.
- No horizontal page overflow at 320–768 px; the header switches to an icon-only **New tournament**
  button at 420 px and hides the navigation below 720 px.
- 44 px tap targets across buttons, links, selects, checkboxes and file inputs.
- Knockout corrections, undo and clear warn before discarding results recorded in later rounds.
- Dialogs focus a sensible control, trap focus and support Escape; route changes move focus to the
  main region.
- A screen-level error boundary handles storage/query failures without blanking the app.
- The creation wizard warns before leaving with unsaved work and confirms when unfinished entries
  would be skipped.
- The footer shows version 1.0.0, and `robots.txt` is included in the build.

There is deliberately **no separate display/TV mode**: the organizer's phone is the only screen.

## Creating a tournament

1. On the dashboard, choose **New tournament**.
2. Work through the five steps: **Basics**, **Format**, **Participants**, **Groups & seeds** and
   **Review**. Each step explains what it needs before it lets you continue.
3. **Save draft** is available on every step. Unfinished participant rows are skipped, so you can
   start with names and fill in the rest later.
4. Open a saved draft from the dashboard to add, edit, remove or deactivate entries. Group changes
   are saved immediately, and **Auto-balance** redistributes active entries across the groups.
5. **Generate draw** creates every fixture in one transaction and marks the tournament as in
   progress. The participant list, groups and fixtures are read-only from that point.

The creation wizard keeps one entry per player in singles and one entry per pair in doubles. A
player can only appear once in the tournament; the same check ignores case, accents and extra
spaces. Team names are optional and are shown instead of the two player names when provided.

For groups + knockout, group previews use the same stored random seed and seeding method as the
final draw. That means the groups you review are the groups that get saved, and the draw can be
reproduced. Byes are placed on the bottom seeds and advance automatically. Drafts are ordinary
tournaments with `status: 'draft'`; they keep their settings and entries but have no matches until
the draw is generated.

## Recording results

Open a tournament that is in progress. Each ready fixture has a **Record result** button; completed
fixtures show **Edit result** instead.

1. Pick the winning side.
2. Optionally enter game scores and a court. The score box follows the tournament's scoring mode:
   winner-only hides scores, single-game allows one game, and best-of-three allows up to three.
3. **Save result**. A knockout winner advances automatically, group qualifiers fill the bracket, and
   every standings table is recomputed from the stored results.

If a result is wrong, edit it and save again. The **Undo last change** button steps back through up
to ten stored states per match, even after a refresh. **Clear result** removes the result and makes
the fixture ready again; clearing can also be undone. Correcting a winner only resets matches
downstream of that result, so unaffected later results stay in place.

In a knockout bracket, changing a winner can invalidate results that were already recorded in later
rounds. Before a correction, undo or clear throws those results away, the app shows how many later
results will be cleared and asks for confirmation. Cancelling leaves every score untouched.

When every required match is finished the tournament becomes **Completed** and a champion banner
appears. Round robin waits for every league match; the other formats wait for the final.

## The knockout bracket

Single elimination and the knockout stage of groups + knockout use a visual bracket instead of a
list of fixtures. Each round is a column, and every match sits halfway between its two feeders, so
the connector lines show where a winner goes next.

- Scroll or swipe sideways inside the bracket panel to move through the rounds. A bracket with many
  entries is taller than the phone screen, so the page also scrolls vertically.
- A bye is shown in grey italics and advances automatically.
- Winners get a check mark and the connector towards the next round turns teal.
- Tap **Record** or **Edit** on a bracket card. The result editor opens in a dialog, so it never
  gets buried below a long bracket. **Cancel**, **Escape** or a tap outside the dialog closes it.
- Group and round-robin fixtures keep their inline result editor.

The bracket layout is a pure helper (`bracketRounds`) that groups knockout matches by round and
assigns each column a span of 1, 2, 4 and so on. CSS grid places the cards, and small connector
lines are drawn with pseudo-elements. No canvas or chart library is needed.

## Backups and storage

Open **Data & backups** from the header, the dashboard button, or the storage link in the footer.
On a narrow phone, the dashboard button and footer link are the quickest way in.

- **Export** downloads one JSON file with every tournament, player, entry, fixture and result. The
  file carries the app name, a format version, the export time and separate arrays for each table.
- **Restore** reads and validates the whole file before changing anything. A confirmation dialog
  shows the file name, export time, counts and tournament names, then replaces the data on this
  device. The device's backup history and storage preferences are kept.
- **Backup history** stores the 20 most recent exports and restores in the `backupActivity` meta
  row, newest first. Damaged history rows are ignored rather than breaking the page, and **Clear
  history** removes only that list.
- **Storage on this device** shows whether the browser granted persistent storage, plus its
  estimated usage and quota for the whole site. When storage is best-effort, **Protect this
  storage** asks the browser again from a tap.

A downloaded file is a normal JSON document, so it can be copied to another phone or kept in any
folder. Nothing is uploaded.

## Structure

```text
src/
  components/   UI kit, layout, and feature panels
  db/           Dexie schema, transactional services, backup, storage helpers
  domain/       Types, seeding, fixtures, standings, results, validation
  pages/        Routed screens (dashboard, create, tournament, data)
  styles/       Design tokens, base styles, component styles
  router.ts     Tiny hash router
  config.ts     App-level constants
tests/          Vitest suites (engine, routing, database, backup, activity, storage, setup, entries, draw, results, bracket layout)
```

## How the draw works

- **Seeding** can be random, manual or snake. A random draw stores its seed, so the same
  fixtures can be reproduced. Manual group changes are applied before anything is saved.
- **Fixtures are generated once** and stored. A round robin uses the circle method, so every
  pair meets exactly once. An odd count simply rests one entry per round.
- **Single elimination** rounds up to the next power of two (2–64) and gives the bottom seeds
  byes. Byes advance automatically, so the next round is ready as soon as its two sides are known.
- **Groups + knockout** draws the whole knockout skeleton up front. Each place remembers which
  group position will fill it, so the bracket can be shown before the group stage ends.
  Qualifiers are filled automatically from the final group tables. If a corrected group result
  changes who advances, the knockout stage is reset rather than leaving a stale winner behind.
- **Standings are never stored**; they are recomputed from results. Points, wins, game difference,
  point difference, head-to-head and seed can be ordered as tie-breakers.
- **Corrections** keep up to ten previous result states per match, so undo works after a refresh.
  Changing a winner clears only the matches downstream of it, then re-advances the untouched side.

## Data ownership

Tournaments never leave the device except through an explicit JSON export.

- The database is `tournament-manager` in IndexedDB, with five tables: `tournaments`, `players`,
  `participants`, `matches` and `meta`.
- Every multi-record operation (generation, regeneration, result cascades, import) runs in one
  transaction, so a failure cannot leave a half-written draw.
- Duplicate players are blocked by a unique index on `[tournamentId + nameKey]`, where the key is
  lowercased, accent-folded and whitespace-collapsed.
- The app asks the browser for persistent storage on first save and shows the current status in
  the footer. The Data & backups screen shows the same status and can ask again.
- A backup envelope carries a format version and is fully validated before a restore. A restore
  replaces the four tournament tables in one transaction but preserves meta, including the backup
  history and the last export/restore timestamps.

## Why so few dependencies

`react`, `react-dom`, `dexie` and `dexie-react-hooks` are the only runtime packages. Routing,
icons, dialogs and the whole visual system are hand-written so the app stays small, loads fast on
a phone at the side of a court, and has nothing that can break because a free service changed.
