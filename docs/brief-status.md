# Implementation brief: status (18 October 2026)

Branch `claude/trusting-shannon-82cdza` (PR #102). Nothing here is in production until the PR is merged:
the live site and the live track record still run the code on `main`.

## Baseline

`baseline/picks-2026-10-18.json.gz` is an unchanged copy of the live track record (track-record branch at
`d0ea77f`). Recomputed totals reproduce the 18 October screenshot exactly: 791–382, 1.44 average odds,
−40.71u, −3.5% ROI, Brier 0.2197 (ATLAS) vs 0.2182 (market) on 1,046 paired picks, −0.32% vs close.

## Audit: what was still reproducible

| Item | Status before this work |
|---|---|
| Pending first copy hides a settled later copy | Already fixed (test existed) |
| Legs of a lost slip stop being graded | Already fixed (test existed) |
| Canonical selection identity | Missing (computed on the fly from the free-text pick only) |
| Conflicting results held back | Missing (one read, final) |
| Postponed vs void | Postponed matches voided at once |
| DNP inferred from a missing stat | **Reproduced**: an empty stat row counted as did-not-play |
| Unresolved retried | No: final after 4 days |
| Audit trail of corrections | Missing |
| Reproducible totals | Totals depended on file order in the last digits |
| Build time shown as data time | **Reproduced**: prices, fixtures, props, starters fell back to the build time |
| Two-way price replacing a soccer three-way market | **Reproduced**: the draw could be lost |
| Spread lines | Alternate lines could be mixed (keyed by absolute line) |
| Assistant validator: a number moved between picks | **Reproduced**: passed with two picks per sentence, a team name, the shared match line, pronouns |
| Assistant single picks vs dashboard | Different selection rules |
| "Tomorrow" | Browser time zone |
| Silent widening | Slip searches widened without saying so; the assistant widened "today" to "next few days" silently |
| Out-of-sample evaluation | Missing: calibration scored on the data it was fitted on |
| Log loss, ROI uncertainty | Missing |
| Quiet hours | Missing |

## What changed (commits on the branch)

1. **Settlement** (`js/settle.js`, `scripts/record.mjs`):
   - Each selection has one canonical id.
   - A result is read twice before it is trusted. If the reads disagree it becomes "disputed" and is held out of every total until two reads agree.
   - An append-only `audit.json` on the track-record branch records every correction, and the Results page shows it.
   - Postponed games wait 72 h and are then voided. DNP only comes from an explicit flag.
   - "Unresolved" is retried for 30 days.
   - The quoted odds on slips are kept (`settledOdds` holds the paid-out odds).
   - Later forecasts are stored as snapshots.
   - Totals are summed in a fixed order.
2. **Recorded pick fields**: canonical id, bookmaker and source, quote type, quote time, calibration version.
3. **Freshness**:
   - `priceTime`: no build-time fallbacks anywhere. A missing time means freshness unknown.
   - `sources.json` per provider: `lastAttemptAt`, `lastSuccessAt`, `status` (ok / empty / failed / off) and `errorCategory`.
4. **Odds**:
   - Draws are preserved.
   - Spread lines are paired from the home side.
   - Averages are labelled "reference, not a price on offer".
   - The bookmaker is shown next to each best price, with the source of the fair chance.
5. **Assistant**:
   - Claim-to-record validation: every number is bound to the pick it is written next to.
   - The hosted prompt requires `[P#]` tags.
   - Single picks come from the dashboard's own functions.
   - Days are counted in the chosen time zone.
   - Any widening is stated.
6. **Slips**:
   - A wider search is labelled on the card.
   - The empty-slip text states the real rules.
   - The parlay of the day says whether every leg is at its fair price or better.
7. **Evaluation**:
   - Walk-forward out-of-sample check (Brier and log loss for model, calibrated and market).
   - 95% ROI interval.
8. **Alerts**:
   - Quiet hours, in the visitor's own time zone.
   - Alerts while ATLAS is closed (`worker/atlas-alerts.js`, `js/pushalerts.js`, `sw.js`): Web Push for saved
     matches from the build's change feed. Each change is sent once, only the chosen kinds, never during quiet
     hours, and each message says whether the forecast moved. Off until the Worker is deployed
     (`worker/README-alerts.md`) and `ALERTS_URL` is set.
9. **Recommendation object** (`js/recommendation.js`): one versioned object (canonical id, line, settlement
   rules, bookmaker, quote id and time, model and calibration versions, raw and calibrated chance, market
   chance, uncertainty range, readiness, missing inputs, constraints, ranking mode). The dashboard cards, the
   assistant's pick cards and recorded picks carry the same `recommendationId`.
10. **Singles near 2.00**: a mode of its own (1.85–2.15), recorded and scored apart from slips and the parlay of
    the day. "No qualifying selection" is shown when nothing qualifies.
11. **Freshness limits** by sport and time to start: prices 6 h → 20 min as the start nears (halved for tennis,
    esports and MMA), team news with its own limits. Starters and absences carried over from an earlier build
    keep their own age and are marked carried.
12. **Assistant follow-ups**: "the second one", "remove the weakest leg" / "drop leg 2", "same filters,
    tomorrow". The remembered list is kept, constraints carry over, and a moved or vanished price is said.
13. **Navigation**: five destinations (Today, Research, Build a slip, Watchlist, Results). Home panels can be
    hidden and reordered, and the layout is kept.
14. **Comparison protocol** (`docs/comparison-protocol.md`, `js/compare.js`): evidence labels, singles and
    parlays apart, ranked only when the 95% ROI intervals separate, otherwise "insufficient evidence to rank".
15. **Second results source** (`js/results2.js`): the confirming read comes from the league's own feed
    (NHL, MLB, NBA, WNBA) or FotMob for soccer, used only for a clearly matched game final after regular time;
    otherwise ESPN is read again. A dispute settles only when both sources agree. The Results page shows how
    many results were independently confirmed. CI check on the baseline's recent results (19 Oct): FotMob
    agreed 61 of 61 matched, NHL 3 of 3, NBA 8 of 8, no disagreement.
16. **Panel widths**: each home panel can be Auto, Third, Half or Full on wide screens.

## Tested

- 226 unit tests and 18 browser tests pass.
- New unit tests:
  - Canonical ids.
  - Confirm and dispute, with the audit entries.
  - Postponed → void after 72 h.
  - Unresolved retries.
  - Slip status with postponed, disputed and DNP legs.
  - History shuffled → identical totals and calibration.
  - Won-vs-push copies flagged.
  - DNP only from a flag.
  - Spread pairing and draw preservation.
  - Price time never falls back to the build time.
  - Validator swap cases (two picks per sentence, "respectively" lists, team names, opponent numbers, pronouns, units).
  - "Tomorrow" in IST vs GMT.
  - Walk-forward never trains on the week it scores.
  - Quiet hours.
- Also: recommendation ids stable across surfaces, uncertainty ranges, near-2.00 selection and its empty
  case, freshness limits, follow-ups, comparison ranking and "insufficient evidence", the alerts Worker
  (once-only sends, chosen kinds, quiet hours across midnight, no back-fill, VAPID token signature).
- Browser tests: every pick the assistant gives is on the dashboard's list with the same recommendation id;
  five-destination navigation; home layout hide/reorder kept after reload; multiplier cards fit on desktop and
  phone; parlay-of-the-day zone switch; quiet hours kept and the alerts-server state shown.
- Dry run of `record.mjs` on the baseline (offline): totals unchanged, 1,520 records given canonical ids, nothing disputed.

## Verified in production

Nothing from this list. The PR is not merged. CI runs every change against live feeds without paid odds credits.

## Unverified / remaining

- **Second results provider.** Covers NHL, MLB, NBA, WNBA and soccer. NFL, college football, tennis, MMA and
  esports are still confirmed by a second read of the same provider.
- **Same-game parlays.** Not offered: ATLAS has no combined same-game quotes, and multiplying the legs of one
  match would misprice them.
- **Panels.** Hidden, reordered and resized in steps (third, half, full); not dragged to any width.
- **Alerts while closed.** Code and tests only; not deployed. Push delivery has not been tested end to end.
- **Hosted AI.** Not configured: `AI_URL` is empty. The assistant runs on the built-in rules and an optional
  model inside the browser.
- **Out-of-sample sample size.** 727 forecasts over 2 weeks: calibrated 0.2126 vs market 0.2131. That is a tie,
  not an edge.

## Feeds and credentials still required

- **Monitoring while the browser is closed:** deploy `worker/atlas-alerts.js` (`worker/README-alerts.md`: KV, VAPID keys as secrets, a 5-minute cron) and set `ALERTS_URL`.
- **Hosted AI:** the Cloudflare Worker in `worker/` deployed, with `AI_URL` set.
- **A second results source** for independent confirmation of results.
- **The Odds API:** the free plan (500 credits a month) prices only the leagues no other feed covers. Line shopping across all sports needs a paid plan.
- **Tennis Abstract:** blocked (HTTP 403). **ClubElo:** intermittently down.
