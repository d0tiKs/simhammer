# Comparison refinement

Refinement reruns promising rough results from a completed Top Gear, Drop Finder,
or Crest Upgrades report. It runs in the local queue with normal progress and
cancellation. Closing the browser does not stop it.

## Select candidates

The UI shows the candidate count before submission and uses the complete report,
regardless of precision visibility filters.

| Mode | Selection rule |
|------|----------------|
| Probability, default | At least a 20% estimated chance of beating the best full-precision result; adjustable from 0 to 100%. Excludes rows without error data. |
| Auto error range | A rough row's upper error bound reaches the best precise row's lower bound. Includes rows with unknown precision. |
| Custom margin | Rough rows within the chosen percentage below the highest result meeting the report's target error. Zero selects only rough rows with higher estimated DPS. |

Probability uses a normal approximation, deriving standard errors from reported
95% error margins and assuming independence. It is a screening score, not a
calibrated probability after selection across many combinations. None of these
modes guarantees that the best unselected combination was included.

`POST /api/sim/{id}/refine` accepts one of:

```json
{"mode":"probability","min_probability_pct":20}
{"mode":"auto"}
{"mode":"custom","margin_pct":0}
```

Each line is a separate request body. Omitting `mode` retains custom-margin behavior.

## Execution and results

Reruns inherit the source's normalized options, base profile, and combination
overrides, changing only precision and iteration ceiling. The ceiling is at
least one million iterations; SimC normally stops at the target error.

The engine is copied to a temporary file to protect it from updater replacement.
A different recorded SimC revision fails the batch, checked after the first rerun.
Revision matching cannot establish that all external data stayed identical.

Success creates a new completed report of the same comparison type. Selected
rows receive new DPS, deltas, and achieved precision; rankings are sorted again.
Other rows, the baseline, and the source report stay unchanged. Reconstruction
metadata supports later reruns; old raw JSON, HTML, and text outputs are not
attached. Failed or cancelled batches do not publish partial combined reports.

## Automatic refinement

Enable "Automatically refine promising results" in Advanced simulation settings.
It is off by default, with a default probability threshold of 20%. Both launch
preferences are saved in the browser, independently of named sim profiles.
Quick Sim and unrelated tools do not use it.

The SQL-backed server polls completed comparisons opted in through
`options.auto_refine_probability`. Each source gets at most one child, named
`auto-refine-<source-id>`, with a marker linking it to the source. Markers and
existing child IDs prevent duplicates across restarts. Refinement children do
not trigger more passes; failed or cancelled children are not retried. No
candidates produces a skipped marker; reconstruction or engine errors produce
an explanatory marker. No schema migration is required.

While watching the initial run, the browser follows its automatic child. Opening
a finished source keeps the original report visible and offers a link to the child.
