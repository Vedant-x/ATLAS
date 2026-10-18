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
8. **Alerts**: quiet hours.

## Tested

- 209 unit tests and 13 browser tests pass.
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
- New browser test: every pick the assistant gives is on the dashboard's list.
- Dry run of `record.mjs` on the baseline (offline): totals unchanged, 1,520 records given canonical ids, nothing disputed.

## Verified in production

Nothing from this list. The PR is not merged. CI runs every change against live feeds without paid odds credits.

## Unverified / remaining

- **Recommendation object.** The full versioned object shared by every card, panel, assistant answer and slip is not done. Recorded picks carry most of its fields, but the pages still build their own views of a pick from the same functions.
- **Second results provider.** Disputes come from a second read of the same provider, not from an independent second source.
- **Freshness limits.** They are not yet set per sport and per input, and they do not tighten as the start time approaches.
- **Retained data.** Odds, absences and starters carried over from earlier builds are not individually flagged as stale.
- **Phase 3.** There is no singles-near-2.00 mode and no same-game parlay mode with real combined quotes. The ATLAS data has no same-game quotes.
- **Phase 4.** The follow-ups "remove the weakest leg" and "same filters, tomorrow" are not implemented. "Explain the second one" replaces the remembered list.
- **Phase 5.** The navigation is not reduced to five destinations. Panels cannot be resized, reordered or hidden. There is no monitoring while the browser is closed.
- **Phase 6.** No competitor comparison protocol has been built.
- **Hosted AI.** It is not configured: `AI_URL` is empty. The assistant runs on the built-in rules and an optional model inside the browser.
- **Out-of-sample sample size.** The check covers 727 forecasts over 2 weeks: calibrated 0.2126 vs market 0.2131. That is a tie, not an edge.

## Feeds and credentials still required

- **Monitoring while the browser is closed:** a push service (for example a Cloudflare Worker with Web Push keys stored as secrets).
- **Hosted AI:** the Cloudflare Worker in `worker/` deployed, with `AI_URL` set.
- **A second results source** for independent confirmation of results.
- **The Odds API:** the free plan (500 credits a month) prices only the leagues no other feed covers. Line shopping across all sports needs a paid plan.
- **Tennis Abstract:** blocked (HTTP 403). **ClubElo:** intermittently down.
