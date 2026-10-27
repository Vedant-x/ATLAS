# Changelog

The site has no versions: every merge to `main` is live within one build (about 20 minutes). This is
what changed, week by week. Reasons and reversals are in [docs/DECISIONS.md](docs/DECISIONS.md).

## Week of 20 October 2026

- **Picks:** three lists (Best bets, Value bets, 2x/3x slips) and the parlay of the day; the losing
  lists retired with their records kept; claims capped at the price's chance + 3 points; blocked bet
  types keep being measured with hidden probes.
- **Data:** Pinnacle's line and the typical price across books on the main leagues; circuit breakers
  for failing sources; TheSportsDB read a little at a time; Open-Meteo within its limits; unpriced
  college leagues off the board; the official NBA injury report; NBA props confirmed from the NBA's
  own box scores; picks only where results can be graded.
- **Pages:** tap-to-open tips instead of hover tooltips, 12 px text, 44 px tap targets, a slimmer
  header, a live-only ticker, plain words, an India-first help page and a year-of-birth age check;
  share previews and search basics.
- **Engineering:** dependencies from npm, ESLint, one CI run per pull request with time limits, a data
  contract check on the real build, the build split into one module per source, Node 24 actions,
  licence, contributing guide and templates.
- **Fix (24 October):** the NBA injury report reader decoded only the first stream of the league's
  PDF, so the first live build read no rows from it. It now reads every page in the page tree's
  order and each row by what its cells hold, and the build log checks its players against ESPN's lists.
- **Node 24 (24 October):** every action now runs on Node 24, the Pages deploy included
  (configure-pages v6, upload-pages-artifact v5, deploy-pages v5, upload-artifact v6); a test fails
  if a workflow goes back to a Node 20 release.
- **Stake's prices (24 October):** Stake's own price beside each price on the main football leagues
  (OddsPapi; on with the ODDS_PAPI_API_KEY secret), on match pages, picks and the bookmaker table.
  A value bet whose Stake price clears the fair odds is taken and recorded at Stake's price.
- **Search pages (24 October):** a plain page per sport and per league at real addresses
  (sports/<id>/, leagues/<key>/) with the week's fixtures, India times, the market's chances, prices and
  schema.org match data, all in a sitemap written each build: the app's #/ pages are one page to a
  search engine.
- **Referees (24 October):** each coming soccer match's referee (FotMob), with that referee's
  yellow and red cards, fouls and home wins per game over this season and last beside the league's
  (football-data.co.uk results, in the leagues whose files name the referee), on the match page.
- **Player data (24 October):** the NBA's own starting fives (expected, then confirmed), tennis
  serve and return figures (the WTA's own; the men's from the 2025 ATP match data) with a
  point-by-point match chance, cricket XIs and squads with roles and styles (ESPN), and esports
  rosters with each player's six-month rating (bo3.gg), on match pages. Every candidate source was
  tested from GitHub's servers first; the ATP's own site, Sofascore and Cricinfo refuse them.
- **Picks at a fair price (25 October):** Best bets only where the price taken (Stake's, where it
  clears) is at or over the sharp market's fair odds; one bookmaker's own price no longer counts (it
  lost 9.1% over 555 picks). Value at Stake now reaches draws and underdogs, where Stake's margin is
  lightest, with a higher bar for longer prices; edges over 12% are treated as data errors. Match
  pages show how far Stake's price sits from the fair odds, and an empty Value bets panel shows
  Stake's closest prices. The build log measures Stake against the fair odds on every build. The
  old Best bets record (363-192, -50.36 units) is kept on Results as a retired list.
- **Fix (25 October):** the page's live refresh (every 30 seconds for a league with a match on
  or about to start) replaced each match's prices with ESPN's bare DraftKings line, dropping the
  sharp market's fair odds and Stake's prices the build had added: Value bets and the Stake rows
  emptied in the browser while the build had found them. A refresh now updates the price and keeps
  the rest; a match priced from many bookmakers keeps its best price until the next build.
- **More of Stake (25 October):** Stake's prices on the Championship, Eredivisie, Primeira Liga and
  Süper Lig too, with the sharp line to judge them by; they fill the second request's free places.
  The main leagues' sharp line is refreshed every 3 hours instead of 8 (within the month's credits):
  Stake prices over a line 5-7 hours old were being set aside as the market had moved since.
- **Never a blank panel (25 October):** when nothing qualifies, Best bets shows the likeliest winners
  nearest a fair price with what each costs on average, and Value bets shows Stake's prices nearest
  the value bar with how far each falls short. Marked as not picks; never recorded. A drifting price
  is set aside only while the sharp line is 3+ hours old: a fresher line already holds the move.
- **Fix (26 October): the page stopped flooding ESPN.** Opening a sport page fetched every league
  straight from ESPN (7 requests a league, retried; over 700 for football) and the refresh asked for up
  to 25 leagues every 30 seconds: ESPN refused the burst, and phones stalled. The browser now asks only
  for leagues the snapshot lacks (12 at most, two days ahead), at most 4 requests at a time, the wider
  refresh every 5 minutes, and after 6 refusals in a row it stops asking ESPN for 2 minutes. A site
  check in CI opens every page with live data on a phone-speed processor and reports errors, failed
  requests, main-thread time and ESPN requests.
- **Review of 27 October:**
  - **No pick without fresh, comparable prices:** missing, future and stale times fail; the quote and
    the market reference are read within 6 hours of each other.
  - **Named chances and returns:** ATLAS's and the market's, each labelled, on cards, in the assistant
    and in the record.
  - **No negative-value slips:** slips and the parlay of the day only from legs at fair odds or
    better, otherwise none.
  - **Quote time:** the quote taken carries its own time.
  - **No fixture-level chance range** until one is validated.
  - **Small records say "too few to judge".**
  - **Feeds:** a failed feed is never "no fixtures"; a missing live score says so.
  - **Near misses** fold into research.
  - **Versions:** the app's and the data's build are shown; updates are offered, not forced.
  - **Site check:** fails on budgets, sideways scrolling, duplicate ids and missing content.
  - **Cohort report:** docs/cohort-report.md, with the recovery plan in docs/model-recovery.md.
- Earlier this week: one site-wide time zone, colour themes, value bets and the drift guard, finished
  matches kept on the watchlist, props on the real over/under lines.

## Week of 13 October 2026

- Player props research (props page, player page, teammate filters), the Android app, golf and
  motor racing, nine sports from TheSportsDB, EuroLeague/EuroCup/Liiga/Swiss hockey, optional odds
  from The Odds API, the Sources page, ATLAS ratings from a results history, weather, NHL goalies and
  expected goals, settlement from two sources with an audit log, the parlay of the day.

## Week of 6 October 2026

- Separate records for each slip size, the research workspace (readiness, timeline, compare), live
  match alerts, DraftKings player props, the KHL and more NCAA sports, data alerts for lasting problems
  only.
