# Model recovery programme

The review of 27 Oct 2026 asked for a profitable selection system to be demonstrated, not assumed,
in seven steps. This file records where each step stands. No step below claims an edge.

## 1. The actual failure cohort: done

`scripts/cohort.mjs` reads the whole track record and splits it by list, slip size, number of legs
and model version. Snapshot: [cohort-report.md](cohort-report.md). For each cohort it reports:
- counts, unique events and the days covered;
- open and unresolved picks (counted, never graded);
- flat-stake profit per pick;
- ROI with a 95% interval from a day-blocked bootstrap;
- the forecast error of the chance shown against the market's own chance on the same picks;
- how often the price taken beat the close.

What it shows, 27 Oct:

- **2x slips:** 2-leg slips went 5–12 (29% won where 54% was shown); 3-leg slips went 1–4. The owner's
  "about 30%" figure is confirmed for 2-leg slips. Fourteen of the 18 slips predate model 2026.10.14,
  so this is the old policy's record.
- **Best bets:** −7.1% ROI over 597 settled picks; the day-bootstrap interval is −14.9% to +0.4%. By
  version: 2026.10.10 −6.8% (−12.2% to −2.6%); 2026.10.11 −22.6% (79 picks). The list under
  2026.10.15 has 1 settled pick: too few to say anything.
- **Retired lists:**
  - Shortlist bankers: −4.6% (−7.6% to −1.2%).
  - Surest: −11.7% (−17.6% to −4.6%).
  - Every retired list's forecast error equals the market's: 0.223 against 0.222 for the bankers.
- **No positive interval:** no cohort has an ROI interval entirely above zero.

The "market" chance in the Brier column is the reference recorded with each pick. Before 25 Oct that
was usually one bookmaker's price with its margin removed, not a sharp line. A comparison against a
sharp reference is only possible from records saved after 27 Oct, which store `refP`.

## 2. One research segment: not started

**Candidate:** main-league football match result. It has:
- Pinnacle's line from The Odds API, refreshed every 3 hours;
- Stake's price from OddsPapi;
- results from ESPN.

The record now keeps the quote, the reference chance and both read times for each pick, which this
needs. Other sports remain research coverage, without a validated model.

## 3. Market and statistical baselines: partly in place

- **Baseline A, the market:** Pinnacle's complete-market odds with the margin removed. The fair chance
  is the lower of the even-split and power methods, and Pinnacle's raw prices are kept (`pin`). The
  record stores the reference from 27 Oct. Odds snapshots are not yet archived per build; that archive
  is needed before a backtest.
- **Baseline B, statistics only:** not built. The current model nudges the market chance with records
  and form, so it is not independent of the market.
- **Challenger:** none. The probability cap (at most the price's chance plus 3 points) stays as a
  heuristic safeguard until a challenger passes the tests below.

## 4. Evaluation without leakage: method fixed, data not yet sufficient

The rules:
- chronological train, calibrate and test windows, plus walk-forward folds;
- results only once settled;
- events grouped across markets and slip legs;
- thresholds never chosen on the final holdout;
- every trial logged.

The record covers 3–27 Oct: too short for an untouched test window.

## 5. Selection policy: interim rules, not validated

The rules now in force:
- Best bets need a fresh reference and a price at or above it.
- Value bets need a heuristic margin above it (2%, rising for long prices).
- An edge over 12% is quarantined.
- Quote and reference must be read within 6 hours of each other.
- Zero picks is allowed.

The 2% bar and the 12% cap are heuristics; they are to be validated per segment and time horizon.
Blocked segments keep being measured by unseen probes.

## 6. Singles before slips: in force

- Slips and the parlay of the day use only legs at or above their fair odds, with no fallback; most
  days there will be none.
- The joint chance assumes independent legs, which sharing no team does not prove; the slip's market
  chance is labelled as such.
- Slip records are kept apart from single-leg accuracy.

## 7. Freeze and forward-test: running

Every recommendation is now recorded at publication with:
- the quote's bookmaker, price and read time, and the reference's read time;
- ATLAS's and the market's chance, each with its return;
- the selection basis and the model version.

Records are settled with an audit log. Flat stakes only. No launch criterion is set by a sample count.
An effect worth having, and the uncertainty that can be tolerated, are to be defined before the
forward record is judged.
