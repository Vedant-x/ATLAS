# ATLAS

Private sports intelligence dashboard: odds analysis, form, head-to-head, lineups and multiplier slips for 8 sports, wrapped in a 3D WebGL interface (three.js + GSAP).

## Run

No build step. Serve the folder and open it:

```sh
python3 -m http.server 8000   # then open http://localhost:8000
```

(Opening `index.html` straight from disk won't work, because ES modules need a server.)

## Pages

| Route | What it shows |
|---|---|
| `#/` | Dashboard: sports, multiplier tiers, upcoming events |
| `#/sport/<id>` | All events for one sport |
| `#/match/<id>` | Form, H2H, ratings, every market with de-vigged probability, both lineups |
| `#/x/2` … `#/x/5` | 5 slips each at ~2x, 3x, 4x, 5x |
| `#/mega` | 100x and 500x accumulators |
| `#/bankers` | 70%+ favourites across all sports, plus value spots |

## How picks are chosen (and why 90% isn't possible)

For every market, the bookmaker's margin is removed to get each outcome's **fair probability**
(`js/engine.js → devig`). The slip builder then searches leg combinations whose total odds land near the
target, ranked by expected value and win chance.

The win chance shown is real math, not marketing. A fairly priced 2x bet wins about 50% of the time, a 5x bet about 20%,
a 100x bet about 1%. A tool that says otherwise is lying. Fewer legs = less margin stacked against you, which is
why the 2x–5x pages often prefer single bets.

Model edge: if a feed outcome carries a `model` probability (your own model), the engine uses that instead of the
market price, and slips with positive EV rank first.

## Data

1. **ESPN live (default).** Each visitor's browser pulls ESPN's public scoreboards (no key) and refreshes every 5 s
   (`REFRESH_MS` in `js/main.js`): 22 soccer leagues, NBA, WNBA, NFL, NCAAF, NHL, MLB, ATP, WTA and UFC (`js/espn.js → LEAGUES`).
   Odds are the US sportsbook ESPN shows (usually DraftKings), **not Stake**. Lineups load from ESPN about an hour before start.
2. **Snapshot.** `scripts/snapshot.mjs` writes `data/odds.json` from the same source; the deploy workflow runs it every 5 min.
   The site uses it if the browser can't reach ESPN.
3. **Demo.** Simulated fixtures if both fail, clearly labelled.

Not covered: **NPB, KBO and cricket**, because ESPN's scoreboard API doesn't carry them and no free, keyless, terms-compliant
source does. SofaScore and Stake have the data but no public API, and scraping them breaks their terms.

## Intelligence (`js/intel.js`)

The model starts from the de-vigged market price (80%) and blends in season record and last-5 form (20%).
- **Bankers** (`#/bankers`): every pick across all sports at 70%+ model chance, the "easy win" radar.
- **Value spots**: where the model rates a side above the price (odds ≤ 5 only; longshot edges are noise).

## Deploy (GitHub Pages)

Repo Settings → Pages → Source: **GitHub Actions**. `.github/workflows/deploy.yml` then deploys on every push to `main`
and every 5 minutes (schedules only run from the default branch).
