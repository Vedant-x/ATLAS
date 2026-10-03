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
