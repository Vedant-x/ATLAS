# Track-record baseline, 18 October 2026

A recoverable copy of the published track record taken before the settlement and recommendation
changes from the implementation brief.

- `picks-2026-10-18.json.gz`: `picks.json` from the `track-record` branch at commit
  `d0ea77f99c36ff7ae668bed8c83e59099e9740aa` (1,638 records), gzip-compressed and unchanged.
- Restore: `gunzip -c baseline/picks-2026-10-18.json.gz > picks.json` and commit it to the
  `track-record` branch.

Totals from `summarize()` in `js/track.js` on this file (they reproduce the 18 October screenshot):

| Record | Won | Lost | Hit rate | Avg odds | Profit | ROI | Brier (ATLAS / market, n) | Price vs close |
|---|---|---|---|---|---|---|---|---|
| Shortlist bankers | 791 | 382 | 67.4% | 1.44 | −40.71u | −3.5% | 0.2197 / 0.2182 (1,046) | −0.32% |
| Surest | 94 | 37 | 71.8% | 1.26 | −12.51u | −9.6% | 0.2002 / 0.2038 (131) | −0.31% |
| Multipliers | 13 | 93 | 12.3% | 155.7 | −61.82u | −58.3% | — | — |
| Outside the rules | 4 | 10 | 28.6% | 3.69 | −0.65u | −4.6% | 0.1886 / 0.1875 (14) | −1.39% |

Also in the file: 63 unresolved and 11 void bankers, 89 pending bankers, 12 pending multipliers and
39 pending surest picks.

What the baseline says: ATLAS's forecasts were slightly worse than the market's own (higher Brier),
prices taken were slightly worse than closing, and the high hit rate came with a loss. Any later
claim of an edge has to beat these numbers prospectively.
