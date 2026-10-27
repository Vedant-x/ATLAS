# Decisions

What was decided, why, and what it replaced. Anything that reverses an earlier decision says so here
first, with the evidence. A change that flips a decision without an entry here should not merge.

## 2026-10-27 · No pick without fresh, comparable prices; no negative-value slips; honest states

- **Decided (review of 27 Oct, P0):**
  - Freshness fails closed: a missing, zero, non-finite, future-dated or too-old time never qualifies a
    pick, and the quote taken must be read within 6 hours of the market reference it is judged against.
  - Every pick carries ATLAS's chance and return and the market's chance and return under their own
    names, with the selection basis. Cards, the assistant and the record use those names.
  - Slips and the parlay of the day are built only from legs at or above their fair odds. The fallback
    to legs up to 7% below (0.93) is now research mode only. No qualifying legs means no slip.
  - A pick's quote time and bookmaker are those of the quote taken (Stake's read for Stake's price).
  - The fixture-level "chance range" is withdrawn: it was a cohort interval.
  - The probability cap (the price's chance plus 3 points) stays as a heuristic safeguard until a
    challenger passes held-out tests.
  - Model 2026.10.16.
- **Decided (P1):**
  - A record under 30 settled picks says so instead of showing a hit rate and ROI.
  - No parlay is a complete answer; singles lead the home page.
  - A failed or paused feed is never "no fixtures".
  - Near misses are folded research with no odds button.
  - An empty list counts why nothing qualified.
  - The footer shows the app's and the data's build; updates are offered, not forced.
- **Why:**
  - The review found three faults: a missing timestamp counted as fresh; slips accepted legs with up
    to −7% estimated return each (two at the floor: −13.5% for the slip); one `ev` field carried two
    meanings.
  - The cohort report (docs/cohort-report.md) shows no list with an ROI interval above zero. 2-leg 2x
    slips went 5–12 against 54% shown.
- **Plan:** docs/model-recovery.md (steps 2 to 7).

## 2026-10-25 · Best bets only at a fair price or better; value at Stake at long prices

- **Decided:** a Best bet needs a sharp fair chance (Pinnacle's with its margin off, or the median of
  many bookmakers) and a price at or over its fair odds: Stake's where it clears them, else the
  board's. One bookmaker's own price no longer counts. Value at Stake runs to long prices (a 12%+
  chance, odds to 10) with a bar that rises one point for every 5 points of chance under 30% (4% at
  20%). Each fair chance is the lower of an even split of the sharp book's margin and the power
  method. An edge over 12% is taken for a data error, never a pick (model 2026.10.15).
- **Why:** Best bets lost 50.36 units over 555 picks (-9.1%). Nearly all were priced at one
  bookmaker's own odds (DraftKings, bo3.gg), which sit under the fair odds by that bookmaker's margin:
  they won 65.4% at average odds 1.41, where 71.0% was needed. Measured on 25 Oct, Stake's 174
  main-league prices sat a median 5.2% under the fair odds (5.9% on 50%+ chances, 3.6% under 30%);
  the 17 over fair were all draws and underdogs, outside Value bets' old 30% / 4.00 range, so the
  list showed none. One of them, a draw at 9.80 against fair odds of 7.01, could only be bad data.
- **Expect:** far fewer Best bets: on the main leagues Stake and DraftKings both charge their margin
  on the favourites, so most days have few or none. Value at Stake comes mostly on draws and
  underdogs. An empty list now means nothing is priced fairly, not that the search failed; the
  Value bets panel then says how far Stake's prices sit from the fair odds.
- **Record:** the old list is a different list, so it is retired with its final record (Results:
  "Best bets at one bookmaker's price", 363-192, -50.36 units), and Best bets' record starts again
  from model 2026.10.15. Its picks still to settle count toward the retired record.
- **Reverses:** "with one bookmaker, ATLAS does not claim more than the price says" (Best bets, 23 Oct).

## 2026-10-24 · Stake's own prices; value bets at Stake are recorded at Stake's price

- **Decided:** Stake's prices come from OddsPapi (the one odds service found that carries Stake;
  The Odds API does not), beside each price on the main football leagues. A value bet whose Stake
  price clears the fair odds is taken and recorded at Stake's price, and listed first (model 2026.10.14).
- **Why:** ATLAS's users bet at Stake from India; a price at another book is one they cannot take,
  and a record kept at it is not one they could have had.
- **Limits:** the free plan allows about 250 requests a month, so one request covers every league,
  spent at an even pace (about one every 3 hours). Other sports join once their market ids are read
  from a live response.

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
