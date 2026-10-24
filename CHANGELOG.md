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
  (OddsPapi; on once an ODDSPAPI_KEY secret is added), on match pages, picks and the bookmaker table.
  A value bet whose Stake price clears the fair odds is taken and recorded at Stake's price.
- **Search pages (24 October):** a plain page per sport and per league at real addresses
  (sports/<id>/, leagues/<key>/) with the week's fixtures, India times, the market's chances, prices and
  schema.org match data, all in a sitemap written each build: the app's #/ pages are one page to a
  search engine.
- **Referees (24 October):** each coming soccer match's referee (FotMob), with that referee's
  yellow and red cards, fouls and home wins per game over this season and last beside the league's
  (football-data.co.uk results, in the leagues whose files name the referee), on the match page.
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
