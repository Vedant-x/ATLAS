# ATLAS

Sports betting research with a public record. ATLAS shows fixtures and prices across most sports,
the chance of each outcome with the bookmaker's cut taken out, player props on the lines bookmakers
actually offer, and three pick lists, and it keeps every pick it has ever made, with its result,
in public.

**Live:** https://vedant-x.github.io/ATLAS/

> Estimates are never guarantees. None of ATLAS's pick lists has made money over its record so far;
> the Results page shows every one. Bet only what you can afford to lose, and only where it is legal.

## Pages

| Route | What it shows |
|---|---|
| `#/` | Today: the parlay of the day, Best bets, Value bets, live now (panels can be hidden and resized) |
| `#/picks`, `#/value`, `#/x/2`, `#/x/3` | Picks: Best bets (likeliest winners at a fair price or better), Value bets (prices above Pinnacle's fair odds), 2x and 3x slips |
| `#/sports` → `#/sport/<id>` → `#/league/<key>` | Every sport, its competitions, then fixtures by day |
| `#/match/<id>` | A match: win chances, the case for and against, best bets, props, then folded detail (team news, starters, records, every market, bookmaker prices) |
| `#/props`, `#/player/<id>` | Player props on real lines, with hit rates and splits; a player's game log |
| `#/live` | Everything in play, with live scoreboards |
| `#/watchlist` | Saved matches with live alerts; finished ones stay with their final score until removed |
| `#/compare` | Pinned matches side by side |
| `#/track` | Results: every pick, locked before the start, graded from the final score; retired lists with their final records |
| `#/sources` | Every data source, how it did on the last build, and what ATLAS does not cover |
| `#/slip/<code>` | A shared slip |

Old addresses (`#/bankers`, `#/edge`, `#/every`, `#/mega`, `#/x/10` …) lead to the list that replaced them.

## Picks

- **Best bets:** the likeliest outcomes at odds 1.20 and up, only where the price is at least the
  market's fair price. A chance shown is never more than 3 points above the price's own.
- **Value bets:** a bookmaker's price at least 2% above Pinnacle's fair odds (3% above the books'
  median where Pinnacle has none). Where Stake's own price clears the fair odds, the bet is taken and
  recorded at Stake's price and listed first; then ones the typical price across books also clears.
- **2x and 3x slips** and **the parlay of the day** (one slip at 1.70 to 2.00).
- Every pick is saved before the start and graded from the final score, read twice (from a second,
  independent source where one covers the league). Bet types whose results fall short of their prices
  are held back, and keep being measured with picks that are recorded but not shown.

## Data sources

| Source | Used for |
|---|---|
| ESPN public APIs | Fixtures, scores, one bookmaker's prices (DraftKings) and match summaries for 150+ competitions; player props; injury lists |
| The Odds API (own key) | Pinnacle's fair line and the typical price across a dozen books on the main leagues; prices where nothing else has one |
| OddsPapi (own key) | Stake's own prices on the main football leagues, beside each price; value bets taken at Stake's price where it clears the fair odds |
| football-data.co.uk | Pinnacle odds for European leagues: a price where none, the sharp line where ESPN prices |
| NBA (official.nba.com, cdn.nba.com) | The league's injury report; box scores to confirm NBA prop results |
| MLB Stats API, NHL API, FotMob, OpenDota | Starters and pitcher reports; second results sources; soccer team news and line-ups |
| npb.jp, koreabaseball.com, KHL, EuroLeague, Liiga, Swiss hockey | Their leagues' schedules, starters and live scores |
| bo3.gg, EsportsBattle | Esports and eFootball |
| TheSportsDB | Darts, snooker, handball, volleyball and other sports ESPN leaves out |
| Jolpica, OpenF1 | Formula 1 |
| Daily Faceoff, Understat, Open-Meteo, Sleeper | NHL goalies, expected goals, kick-off weather, NFL injuries |
| ClubElo, World Football Elo, Tennis Abstract | Ratings for unpriced matches (each paused while it refuses the build's requests) |

Every build publishes `data/sources.json` (the Sources page) and `data/health.json`; a source down for a
day opens one GitHub issue, closed when it recovers.

## How it runs

- `.github/workflows/pages.yml` builds the site about every 20 minutes (each run queues the next),
  records picks and results on the `track-record` branch, and between builds publishes live scores
  for feeds that block browsers on the `live-data` branch (only when a score changes).
- `.github/workflows/ci.yml` runs on every pull request: lint, unit tests (at every hour of the day),
  a build against the live feeds, the data contract on that build, and browser tests on the bundle.
- In the browser, live scores refresh from ESPN every few seconds while games are on.

## Develop

Node 22. See [CONTRIBUTING.md](CONTRIBUTING.md).

```sh
npm ci            # pinned dependencies; builds vendor/
npm run lint && npm test
npm run build     # dist/pages against the live feeds
npm start         # preview on http://127.0.0.1:8080
```

## Project layout

```
index.html, css/*.css         page shell and styles in six parts (access.css last: readability rules)
sw.js, manifest.webmanifest   offline cache and installable app; android/ wraps it as an APK
js/
  main.js                     router, live polling, slip, events
  views.js, picksview.js      page templates (home, sports, match; the Picks pages)
  research.js, dossier.js     research workspace and the match dossier
  intel.js, models.js         the model: margin removal, evidence shift, score/margin/set models
  track.js, trackview.js      pick rules, the record, the Results page
  settle.js, results2.js      grading from two sources, disputes and the audit log
  oddsapi.js, footballdata.js bookmaker prices and the sharp line
  props.js, propsview.js      player props: lines, hit rates, the prop model
  nbainjury.js, newsgate.js   the NBA's injury report, and NBA picks waiting on it
  breaker.js, contract.js     source circuit breaker; the data contract
  tips.js, esc.js             tap-to-open tips; HTML escaping
  assistant/                  the on-page assistant (built-in answers; optional on-device AI)
scripts/
  pages.mjs, lib.mjs          the build, and its shared helpers
  sources/                    one module per outside source
  record.mjs, changes.mjs     track record and change timeline
  live-lane.mjs               live scores between builds
  check-data.mjs              the data contract on a build
  vendor.mjs, serve.mjs       vendor/ from npm; local preview
worker/                       optional Cloudflare Workers (hosted AI, alerts while closed)
test/                         unit tests, browser tests (test/ui), fixtures
docs/                         decisions log, comparison protocol, the 18 Oct brief status
```

## Licence

All rights reserved: see [LICENSE](LICENSE).
