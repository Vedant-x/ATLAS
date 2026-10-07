# ATLAS

Sports betting research: live fixtures across every major sport, margin-free probabilities, a model
that prices every market, match dossiers, a shortlist of high-chance picks, multiplier slips and a
public track record. Static site on GitHub Pages; free to run, no keys.

**Live:** https://vedant-x.github.io/ATLAS/

> Probabilities are estimates, never guarantees. Bet only what you can afford to lose.

## Pages

| Route | What it shows |
|---|---|
| `#/` | Today: live strip, shortlist, multipliers, upcoming |
| `#/live` | Everything in play, with live scoreboards |
| `#/sports` → `#/sport/<id>` → `#/league/<key>` | All sports, their competitions, then fixtures by day |
| `#/match/<id>` | Match dossier: the case, best bets, starters, absences, form, stats, every market priced |
| `#/bankers` | The shortlist: likeliest picks at odds 1.30–1.80 |
| `#/x/<n>`, `#/target`, `#/mega` | Slips near a multiplier (10x and up use the next 7 days) |
| `#/edge` | Every price with fair odds, model chance and edge |
| `#/watchlist` | Saved matches with live alerts (goals, cards, periods, full time) |
| `#/compare` | Pinned matches side by side |
| `#/track` | Track record of shortlist picks, saved before kick-off and graded after |

## Data sources (free, no keys)

| Source | Used for |
|---|---|
| ESPN public APIs | Fixtures, scores, odds and match summaries for 150+ competitions, cricket, F1 schedule; DraftKings player props (NBA, WNBA, MLB, NHL, soccer) |
| MLB Stats API | Probable starters, pitcher reports, injured list |
| npb.jp, koreabaseball.com | NPB and KBO schedules, starters and pitcher lines |
| FotMob | Soccer injuries, suspensions and line-ups |
| bo3.gg, EsportsBattle | Esports (CS2, Valorant, LoL, Dota 2) and eFootball |
| Jolpica, OpenF1 | F1 results, standings and live timing |

## How it runs

- `.github/workflows/pages.yml` builds the site and `data/index.json` and redeploys about every 10 minutes
  (each run queues the next). It also records shortlist picks and their results on the `track-record`
  branch and publishes live NPB/KBO/esports scores on the `live-data` branch.
- In the browser, live scores refresh straight from ESPN every few seconds while games are on.
- `.github/workflows/ci.yml` runs the tests and a full build on every pull request.

## Project layout

```
index.html, css/style.css   page shell and all styles (phone rules last)
sw.js, manifest.webmanifest offline cache and installable app
js/
  main.js                   router, live polling, slip, events
  views.js, research.js     page templates (dashboard, sports, match, watchlist, compare)
  dossier.js, detail.js     match dossier sections and their data
  intel.js, models.js       the model: market de-vig, evidence shift, score/margin/set models
  engine.js, picks.js       de-vig helpers and slip building
  track.js, trackview.js    track record rules and page
  espn.js, catalog.js       ESPN feeds and the list of every sport and competition
  alerts.js, livealerts.js  watchlist, change alerts and live match notifications
  assistant/                the on-page assistant (built-in answers; optional on-device AI)
  …                         per-source loaders (cricket, esports, f1, fotmob, mlbstats, asia-live)
scripts/
  pages.mjs                 builds dist/pages and data/index.json
  record.mjs, changes.mjs   track record and change timeline (run by the deploy workflow)
  live-lane.mjs             NPB/KBO/esports live scores between builds
  serve.mjs                 local preview server
vendor/                     GSAP, three.js, WebLLM (vendored, no build step)
worker/                     optional hosted AI (not used unless configured in js/config.js)
test/                       node:test suites
```

## Develop

Node 20+, no dependencies.

```sh
npm test          # unit tests
npm run build     # fetch live data and build dist/pages
npm start         # preview on http://127.0.0.1:8080
```
