# ATLAS

Sports intelligence dashboard: live fixtures for every major sport, margin-free probabilities, a
model that prices every market, full match dossiers, multiplier slips and an edge board, with a 3D
animated interface. Static site, deployed to GitHub Pages and rebuilt every 15 minutes.

**Live:** https://vedant-x.github.io/ATLAS/

> Probabilities are estimates from prices, records and form, never guarantees. Bet only what you can afford to lose.

## Pages

| Route | What it shows |
|---|---|
| `#/` | Dashboard: live strip, match of the day, bankers, value spots, multipliers, upcoming |
| `#/sports` → `#/sport/<id>` → `#/league/<key>` | Every sport, its competitions, then fixtures by day (tennis: tournament → singles/doubles → round) |
| `#/match/<id>` | Match dossier: win probability, starters (full pitcher reports), injuries/absences, team stats, form, head-to-head, standings, every market priced, calculator |
| `#/edge` | Every price on the board with fair odds, model probability, edge and quarter-Kelly |
| `#/x/2` … `#/x/20` | Slips near each multiplier, built only from matches still to start today |
| `#/mega` | 100x / 500x long shots |
| `#/bankers` | 70%+ favourites across every sport |

The **3D ON/OFF** button in the header turns the WebGL background off (remembered per device; `?lite` in the URL does the same).

## Data sources (all free, no keys)

| Source | Used for |
|---|---|
| ESPN public APIs | Fixtures, scores, reference odds, match summaries for 150+ competitions |
| MLB Stats API | Probable starters with season/postseason/career lines, game logs, splits, vs-opponent, injured list |
| npb.jp | NPB schedule, probable starters, pitcher year-by-year, recent starts from box scores |
| koreabaseball.com | KBO schedule, starters, season/career, last 10 starts, splits, injured list |
| FotMob | Soccer injuries and suspensions |

## Project layout

```
index.html          single page shell
css/style.css       all styles (phone rules last)
js/
  main.js           router, navigation, slip, polling
  views.js          page templates
  dossier.js        match dossier sections (starters, injuries, stats, form…)
  scene.js          three.js background
  catalog.js        every sport and competition
  espn.js           ESPN scoreboards/summaries
  detail.js         per-match detail loader
  mlbstats.js       MLB Stats API starter reports
  fotmob.js         soccer absences
  models.js         probability models (Poisson, margin, tennis sets)
  engine.js         de-vig, slip builder, same-day filter
  intel.js          model blending, bankers
vendor/             three.js and GSAP (vendored, no build step)
scripts/pages.mjs   builds dist/pages + data/index.json (NPB/KBO scrapers, MLB/FotMob enrichment)
scripts/serve.mjs   local preview server
test/               node:test suites
.github/workflows/  pages.yml (deploy every 15 min), ci.yml (tests + build on branches)
```

## Develop

Node 20+, no dependencies.

```sh
npm test          # unit tests
npm run build     # fetch live data and build dist/pages
npm start         # preview on http://127.0.0.1:8080
```

## Stake odds connection

`#/stake` shows **Stake quotes via Odds-API.io**, an independent provider. Matched research dossiers also show a separate Stake table. Matching requires both full participant names, sport and kickoff to agree; ambiguous matches remain unlinked. These quotes do not silently replace ESPN/reference prices in the existing assistant, models or multiplier engine.

The connection is optional. With no key, the board reports **not configured** and makes no provider requests. Activation requires an Odds-API.io account entitled to Stake; select **Stake** (not Stake.bet.br) in that account. Current provider documentation says new free keys are paused. No subscription is created by ATLAS.

### Activate on the existing GitHub Pages site

1. Open repository **Settings → Secrets and variables → Actions**.
2. Add repository secret **ODDS_API_KEY** with the provider key. Never put it in `js/config.js`, an issue, source code or a browser form.
3. Run **Deploy to GitHub Pages** under Actions, or wait for the next scheduled build.
4. Open **Stake odds** and inspect its collection status, source update times and available events.

Optional Actions repository variables:

| Variable | Default | Purpose |
|---|---|---|
| `STAKE_SPORTS` | `football,basketball,baseball` | Comma-separated provider slugs; e.g. `tennis,ice-hockey,american-football,cricket,esports` |
| `STAKE_MAX_EVENTS` | `20` | Closest upcoming events; bounded to 80 |

The default scope uses up to **5 provider requests per collection** (3 event lookups + 2 odds batches). A 15-minute schedule can use 480/day, plus push/manual builds. Adding sports/events increases usage. Existing free accounts have documented daily/hourly limits; tune scope to your actual plan. The collector stops on 401, 403 or 429 and exposes a sanitized error status rather than printing authenticated URLs.

**Pages serves snapshots, not streaming odds.** The existing build is scheduled every 15 minutes and can be delayed. Browser score refreshes never reset a Stake quote's timestamp. Source quotes older than five minutes, missing timestamps or already-started games are marked expired. Markets can be suspended between collections. Check the exact offered price and market rules on Stake before using a quote. Available provider markets only; no claim of complete Stake coverage or in-play coverage.

### Local refresh

Export `ODDS_API_KEY`, `STAKE_SPORTS` and `STAKE_MAX_EVENTS` in the server environment, then `npm start`. On Node 22.9+ you can instead copy `.env.example` to `.env`, fill it privately, and run:

```sh
node --env-file=.env scripts/serve.mjs
```

The local `/api/stake-odds` endpoint caches sanitized responses for 60 seconds and coalesces concurrent requests. Minute refresh uses substantially more quota than the Pages schedule. It listens only on localhost and never serves `.env`, Git metadata or collector source files.

Provider contracts: [Stake coverage](https://odds-api.io/sportsbooks/stake), [current access and limits](https://docs.odds-api.io/llms.txt), [authentication](https://docs.odds-api.io/authentication). Provider redistribution terms apply to quotes published on the public Pages site.
