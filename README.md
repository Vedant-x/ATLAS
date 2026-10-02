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

## How picks are chosen (and why 90% isn't possible)

For every market, the bookmaker's margin is removed to get each outcome's **fair probability**
(`js/engine.js → devig`). The slip builder then searches leg combinations whose total odds land near the
target, ranked by expected value and win chance.

The win chance shown is real math, not marketing. A fairly priced 2x bet wins about 50% of the time, a 5x bet about 20%,
a 100x bet about 1%. A tool that says otherwise is lying. Fewer legs = less margin stacked against you, which is
why the 2x–5x pages often prefer single bets.

Model edge: if a feed outcome carries a `model` probability (your own model), the engine uses that instead of the
market price, and slips with positive EV rank first.

## Data feed

The site ships with **simulated demo data**. To use real prices, write `data/odds.json`:

```json
{
  "source": "my-feed",
  "events": [{
    "id": "football-1", "sport": "football", "league": "Premier League",
    "home": "Arsenal", "away": "Chelsea", "start": 1767225600000, "live": false,
    "markets": [{ "name": "Match Result", "outcomes": [
      { "name": "Arsenal", "odds": 1.85 }, { "name": "Draw", "odds": 3.6 }, { "name": "Chelsea", "odds": 4.2, "model": 0.27 }
    ]}],
    "stats": { "homeForm": ["W","W","D","L","W"], "awayForm": ["L","W","W","D","L"],
               "h2h": { "home": 3, "draw": 1, "away": 2 }, "homeRating": 1820, "awayRating": 1760 },
    "lineups": { "home": [{ "pos": "GK", "name": "Raya", "rating": 7.1, "status": "fit" }], "away": null }
  }]
}
```

Sport ids: `football basketball tennis cricket hockey mma baseball esports`.
Only list mutually exclusive outcomes in a market (e.g. not "Double Chance"), since de-vig assumes they sum to 1.

**About Stake.com:** Stake has no public odds API, and scraping it breaks its terms of service. The legal routes
are a licensed odds API (e.g. The Odds API, Sportradar, OddsJam), or entering Stake prices yourself into `data/odds.json`.
