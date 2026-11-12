# Release QA — version 1.0.0

Last run: **11 November 2026** · Target: amateur badminton/pickleball, one organizer, one phone.

This document records what was tested for release 1.0.0, the results, and the checks to repeat
before a future release. It covers automated tests plus a manual browser pass. It does not claim a
screen-reader audit on a physical phone.

## Commands used

| Check | Command | Result |
| --- | --- | --- |
| TypeScript | `npm run typecheck` | Pass, 0 errors |
| Domain + database tests | `npm test` | Pass, 172 tests in 16 files |
| Production build | `npm run build` | Pass, static files in `dist/` |
| Preview | `npm run preview -- --port 4173 --strictPort` | Served from `dist/` |

The GitHub Actions workflow runs `npm ci`, `npm test` and `npm run build`, then publishes `dist/`
to GitHub Pages. The build is relative (`base: './'`) and hash-routed, so the same files work from
a project URL, a user page, a custom domain or a local folder.

## Automated coverage

| Suite | What it protects |
| --- | --- |
| `tests/seeding.test.ts` | Random/manual/snake ordering, group allocation, repeatable seeds |
| `tests/elimination.test.ts` | Bracket sizes 2–64, seed order, byes, automatic advancement |
| `tests/roundRobin.test.ts` | Circle-method pairings, odd counts, no duplicate matches |
| `tests/groupsKnockout.test.ts` | Group stage, qualifier filling, group-avoidance, knockout skeleton |
| `tests/standings.test.ts` | Points, wins, game difference, point difference, head-to-head, seed |
| `tests/results.test.ts` | Record, score validation, correction, undo/clear, champion, downstream counts |
| `tests/resultsDb.test.ts` | Stored result services and transactional updates |
| `tests/bracketLayout.test.ts` | Round columns, spans, connector positions |
| `tests/backup.test.ts` | Export envelope, validation, restore replacement, preserved meta |
| `tests/db.test.ts` | Transactions, schema indexes, duplicate-player constraints |
| `tests/entries.test.ts` | Draft entries, create tournament, generate draw |
| `tests/setup.test.ts` | Entry validation, group previews, draw prerequisites |
| `tests/activity.test.ts` | Backup history cap and damaged rows |
| `tests/storage.test.ts` | Persistent-storage status, byte formatting, browser-less fallbacks |
| `tests/router.test.ts` | Hash routes, not-found handling |
| `tests/generate.test.ts` | Round-robin, elimination and groups + knockout generation |

## Functional matrix

Checked in the production build with real IndexedDB data. “Pass” means the visible result and the
stored data both matched the expectation.

| Area | Cases | Result |
| --- | --- | --- |
| Formats | Single elimination (4, 5, 8, 16), round robin (odd/even), groups + knockout (1–4 groups) | Pass |
| Byes | 3, 5, 6, 7 entries; bye advances without a result button | Pass |
| Results | Winner-only, single game, best of three; optional court; score/winner mismatch blocked | Pass |
| Corrections | Edit score without changing winner; change winner; undo history after reload | Pass |
| Destructive edits | Downstream results cleared; warning states how many; Cancel keeps all data | Pass |
| Standings | Live update after each result; tie-breakers reorder rows; qualifiers highlighted | Pass |
| Champion | Round robin waits for every league match; knockout waits for the final | Pass |
| Groups | Preview groups equal saved groups; qualifiers fill the bracket; corrected group result resets stale knockout winners | Pass |
| Drafts | Save at any step; unfinished rows skipped; edit/reopen later | Pass |
| Backups | Export, validate, restore; 20-entry history; clear history keeps tournaments | Pass |
| Data safety | Restore replaces tournament tables, keeps meta; invalid file changes nothing | Pass |
| Errors | Missing tournament, unknown route, storage error screen; header/footer stay usable | Pass |
| Navigation | Back/forward, direct hash URL, refresh mid-tournament, browser restart + restore | Pass |

## Responsive matrix

Measured in a 320/360/390/414/430/768 px viewport, including dashboard, create wizard, data page,
completed knockout, byes bracket and groups + knockout. For each screen the check was:

1. document `scrollWidth` does not exceed `clientWidth`;
2. the header stays on one row with the icon-only **New tournament** button at ≤420 px;
3. long tournament, participant and fixture names wrap instead of pushing the page sideways;
4. tables and brackets scroll inside their own labelled region, not the whole page.

| Width | Screens checked | Horizontal overflow | Notes |
| --- | --- | --- | --- |
| 320 px | Dashboard, Create, Data, all three tournament screens | None | Icon-only CTA, nav hidden |
| 360 px | Same | None | Icon-only CTA |
| 390 px | Same | None | Icon-only CTA |
| 414 px | Same | None | Icon-only CTA |
| 430 px | Same | None | Full header CTA text fits |
| 768 px | Same | None | Nav and CTA visible |

Fix made during this pass: standings, tournament-card and data grids now use
`minmax(min(280–290px, 100%), 1fr)`, which removed a 1 px overflow at 320 px.

## Tap targets

Interactive controls were measured at 320–390 px. Buttons, icon buttons, selects, checkboxes, file
inputs, summaries, nav links, the brand link and tournament title links are at least 44 × 44 px
(visually or through their hit area). The skip link also uses the 44 px minimum. No interactive
control measured below 44 px in the final pass.

## Accessibility

Lighthouse (Chromium, production build, no device emulation):

| Screen | Accessibility | Best practices | SEO |
| --- | --- | --- | --- |
| Dashboard | 1.00 | 1.00 | 1.00 |
| Create wizard | 1.00 | 1.00 | 1.00 |
| Completed knockout | 1.00 | 1.00 | 1.00 |
| Groups + knockout | 1.00 | 1.00 | 1.00 |
| Data & backups | 1.00 | 1.00 | 1.00 |

The earlier 0.96 / 0.80 run failed on muted-text contrast, warm-badge contrast, a brand
accessible-name mismatch and a missing robots file. Release fixes:

- `--muted` is now `#5b6773` and `--warn` is `#9a5207`; both pass 4.5:1 on the app surfaces.
- The brand link uses its visible text as its accessible name.
- `public/robots.txt` is included in the build.
- Winner checks carry screen-reader text, and winner choices expose `aria-pressed`.
- Destructive result edits explain how many later results will be cleared.
- Standings and bracket scroll regions are focusable and labelled.
- Dialogs trap focus, support Escape, and return focus to the trigger.
- One page-level `h1` per screen; section headings step down without skips.
- Route changes move focus to `<main>`; an error boundary keeps the header and footer usable.
- Create-wizard validation is a focused alert; leaving a partly filled wizard warns first.

Not covered: a manual pass with VoiceOver/TalkBack or NVDA, and a physical-device touch test. The
markup and Lighthouse results are the current evidence; repeat these with a real phone before a
public event if screen-reader users are expected.

## Known limitations

- Data lives in one browser profile on one device. There is no account, sync or server backup.
- A browser restart keeps IndexedDB, but “clear site data”, private-window cleanup or storage
  eviction removes it. Export a backup after each event; use the restore screen on another device.
- Persistent storage is requested but the browser may still evict best-effort storage.
- The bracket and standings tables scroll sideways on small phones by design.
- No separate TV/display mode; the organizer’s phone is the only screen.

## Release checklist

1. `npm run typecheck`, `npm test`, `npm run build`.
2. Serve `dist/` and run the functional matrix on a phone-sized viewport.
3. Run Lighthouse on dashboard, knockout, groups + knockout and data screens; expect 1.00/1.00/1.00.
4. Verify 320 px overflow and 44 px tap targets on every screen.
5. Export a backup, restore it, and confirm tournaments, entries, results and history survive.
6. Push to `main`; confirm the Pages workflow deploys the new `dist/`.
