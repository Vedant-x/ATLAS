# Decisions

What was decided, why, and what it replaced. Anything that reverses an earlier decision says so here
first, with the evidence. A change that flips a decision without an entry here should not merge.

## 2026-10-24 · Engineering: dependencies from npm, a linter, one CI run per pull request

- **Decided:** three.js, GSAP and WebLLM come from pinned npm packages (`scripts/vendor.mjs` builds
  `vendor/` after `npm ci`); ESLint runs on every pull request; CI runs once per pull request (not on
  the push as well), on a pinned Ubuntu 24.04 runner, with time limits on every slow step; the build
  script is split into one module per data source (`scripts/sources/`).
- **Why:** 6.5 MB of other people's code was committed; the bundler was installed with `|| true` so a
  broken install shipped unbundled files; CI ran twice per push and its browser step could hang for
  10 minutes; `scripts/pages.mjs` was 1,600 lines.
- **Replaces:** the vendored copies (their history stays in Git).

## 2026-10-24 · The league's own NBA injury report

- **Decided:** the official report (PDF, official.nba.com) sets the status of every listed player for
  NBA games; ESPN's lists fill in the rest. Probable players keep their props.
- **Why:** ESPN's injury lists follow the league's report, sometimes hours late, and NBA picks wait on
  injury news (`js/newsgate.js`).

## 2026-10-24 · Pages are readable on a phone

- **Decided:** no hover-only information (tips open on tap), text at 12 px or more, controls at 44 px
  on phones, no floating assistant on phones, a header of three controls, a ticker of live scores only.
- **Why:** a review found up to 64 hover-only tooltips per page, invisible on phones, text down to 9 px
  and tap targets under 32 px. The browser tests now check every main page for all four.

## 2026-10-24 · Data: the sharp line on the main leagues, breakers, honest health

- **Decided:** Odds API credits go first to the most-bet leagues, to lay Pinnacle's fair line and the
  typical price across books over ESPN's one-book price; a source failing 3 builds in a row is paused
  and retried every 6 hours; unpriced college leagues are left to their pages; picks are only offered
  where the record can grade them.
- **Why:** Value bets found 2 a day, both at Swedish books; 42% of the board was unpriced; ClubElo
  (502) and Tennis Abstract (403) failed on every build while the log said "DATA HEALTH: ok";
  eSoccer and cricket-feed picks could never settle.

## 2026-10-23 · Three pick lists; the rest retired

- **Decided:** Best bets, Value bets, and 2x/3x slips (plus the parlay of the day). A shown chance never
  sits more than 3 points above the price's own.
- **Retired, with their final records kept on Results:** Shortlist bankers, Surest, Singles near 2.00,
  model-only picks, 4x–20x slips, Mega slips (100x, 1000x), the Every sport page and the edge board.
- **Why:** every list lost money over its record (Surest −10.6%, multipliers −65%); the model's
  forecasts were no better than the price's (Brier 0.221 vs 0.219); props claimed 78.9% and won 67.9%.
- **Reverses:** "Stronger multipliers, a safest tier" (16 Oct), "Surest picks" (16 Oct), "Every sport:
  priced and model-rated picks" (18 Oct), "Singles near 2.00" (18 Oct).

## 2026-10-23 · No NBA page

- **Decided:** NBA picks and props live in the shared lists; there is no NBA-only page.
- **Why:** the owner asked for better NBA research, not a separate page.
- **Reverses:** "NBA page and home panel" (#114, merged and reverted the same day).

## 2026-10-23 · NBA picks wait on injury news, but still come hours ahead

- **Decided:** a game is held only while one of its key players is questionable or doubtful;
  otherwise picks come 6+ hours ahead (visitors in India bet the evening before).
- **Why:** NBA picks made hours early whose price then drifted won 32% against 67% implied.
- **Reverses:** an earlier same-day rule that held every NBA pick until close to tip-off.

## 2026-10-20 · Banker of the day removed

- **Reverses:** "Banker of the day" (#106), added the same day. One extra single on the home page
  duplicated Best bets.

## 2026-10-19 · TheSportsDB is not a second results source

- **Reverses:** "Second results source for the NFL and college football (TheSportsDB)", the same day.
- **Why:** TheSportsDB refuses GitHub's servers (HTTP 403).

## 2026-10-07 · 3D and motion off by default

- **Why:** the 3D page objects (6 Oct) slowed ordinary laptops; they were removed the next day and the
  remaining scene starts off.
