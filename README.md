# ATLAS
Private sports research dashboard with live public-source adapters, match dossiers, news, an Aura chat connection, and a Stake-price multiplier explorer, fronted by a cinematic 3D dashboard (three.js + GSAP).

| Page | What it shows |
|---|---|
| `/` | Dashboard: live strip, match of the day, sports, bankers, value, multipliers, headlines, upcoming |
| `/#/match/<id>` | Match dossier: win probability gauges, fair vs bookmaker odds, edge, Kelly; score/margin/set model; every derived market; bookmaker price table; form; lineups; injuries; stake calculator; model notes |
| `/#/edge` | Edge board: every bookmaker price on the board with fair and model probability, edge and Kelly, filterable and sortable |
| `/#/x/2` … `/#/x/20` | Slips near each target multiplier |
| `/#/mega` | 100x, 500x and 1000x accumulators |
| `/#/bankers` | 70%+ favourites across every sport, plus value spots |
| `/desk.html` | Research desk: Ask ATLAS / Aura, multiplier lab, source monitor, connections |

Every price can be tapped into the bet slip (kept in the browser), which shows combined odds, true win chance, edge and returns.

## Run
Node.js 22 or later. No package dependencies.

```sh
cp .env.example .env
npm start
```
Open http://127.0.0.1:8768. The server binds only to localhost. It refreshes feeds every 60 seconds while running; the browser also refreshes every 60 seconds while visible. Public feeds may be delayed or unavailable. No all-market completeness is claimed.

## Data
- Official MLB schedules, scores, probable pitchers and batting orders on demand.
- Official NHL schedules/scores and match detail; official NPB schedules/scores.
- ESPN NBA, NFL, ATP/WTA and seven soccer competition schedules. Successful empty schedules are separate from errors.
- ESPNcricinfo current score summaries, BBC sports headlines, Valve esports announcements.
- KBO adapter currently returns an unsupported response. Esports tournament fixtures are not connected. Source monitor reports these gaps.
- Complete injury reports, expected lineups and confirmed lineups across all sports are not implemented. Missing information remains explicitly unknown.

## Prices on the 3D dashboard
Each match uses its fresh Stake prices (≤ 5 min old) when the Odds-API.io key is connected and the teams match a Stake event. Otherwise it shows ESPN's reference line (a US sportsbook, labelled "not Stake"). NPB, KBO and cricket have no free odds line, so they appear without prices until Stake is connected.

## Market models (`js/models.js`)
From each event's prices ATLAS derives the full market set. Goal sports (football, hockey, baseball) fit a Poisson score model to the winner price and total line, giving a correct-score grid, double chance, draw no bet, alternate totals, handicaps/run/puck lines, team totals, both teams to score, clean sheets, exact totals and winning margins. Basketball and NFL use a normal margin model centred on the spread (or moneyline) for alternate spreads/totals, team totals and margin bands. Tennis solves a per-set win chance for set betting and total sets. Events with no bookmaker price get a model line from season record and form (labelled MODEL), or a home-advantage baseline (BASELINE) when there is no data. Derived numbers are fair prices (1 / probability), not bookmaker quotes.

## Intelligence (`js/intel.js`, `js/engine.js`)
Prices are de-vigged into fair probabilities. Season record and last-5 form may nudge the market price by at most 0.08 in log-odds (about ±1–2 percentage points); the market stays the main signal. Slips are ranked by expected value and win chance and shown with their real win chance: a 2x bet wins about 50% of the time, 5x about 20%, 100x about 1%. Nothing here can make 2x+ slips win 90% of the time. Bankers are picks at 70%+ model chance; value spots are where the model rates a side above the price (odds ≤ 5 only).

## Stake prices and analysis
Set ODDS_API_KEY from an Odds-API.io account with Stake coverage. A Stake login or model API key cannot substitute for this feed. Provider access/quotas apply; no key is included. Maximum 80 upcoming events per refresh, not the entire Stake market. No automated wagering.

The Ask ATLAS form returns a market-favourite shortlist only with verified fresh prices. There is no validated probability model or claim of profitable edge. Multiplier targets: 2x, 3x, 4x, 5x (up to five options), 10x, 20x, 100x, 1000x (up to three). Fewer options are returned if data is insufficient. Prices older than five minutes, past events, repeated participants and multiple legs from the same event are excluded. Reciprocal odds are break-even thresholds, not predictions. Bookmaker acceptance and correlation can change combined payout.

## Aura
AURA_URL defaults to https://aura-production-0486.up.railway.app. Optional AURA_API_TOKEN remains server-side. ATLAS uses POST /chat with {text}, never screen endpoints. Aura may retain requests in its existing memory. On 2026-10-02 the supplied deployment returned HTTP 404, Application not found. Integration is wired but requires the service to be restored.

Local connection forms save credentials to ignored .env with mode 0600. Never commit keys. Static files are allowlisted. The optional Worker build requires private hosting/access control before deployment; it includes no login by itself and does not support browser credential saving.

## Verification
npm test covers price freshness, IST boundaries, tennis grouping, duplicate-leg exclusions and combination arithmetic. npm test also covers the 3D dashboard's feed adapter, ESPN odds conversion, de-vig maths and bankers. npm run build creates dist/client and dist/server for a Worker-compatible host. Tests use synthetic fixtures, never presented as live dashboard data.
