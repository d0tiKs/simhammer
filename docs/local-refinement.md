# Local Top Gear refinement

The rankings default to Auto selection: a rough result is included when its
upper error bound reaches the lower error bound of the highest-DPS precise
result. Results with unknown precision are included conservatively. This can
select many more combinations, so the count is shown before starting.

Custom selection offers a margin below the highest result whose stored error meets the
report's target error. A margin of zero selects only rough combinations with a
higher estimated DPS. Wider margins include additional rough contenders. The UI
shows the candidate count before submission. Selection ignores the precision
visibility filter and uses the complete report.

`POST /api/sim/{id}/refine` accepts `{"mode":"auto"}` or
`{"mode":"custom","margin_pct":0}`. Requests without `mode` retain the original
custom-margin behavior. Copied reports record which mode was used. Only completed Top Gear
jobs are supported. The operation runs through the local simulation queue, with
progress and cancellation available through the normal job endpoints. Closing
the browser does not stop it.

The reruns inherit the normalized source options and base profile, override only
the requested precision and iteration ceiling, and apply each combination's
stored overrides. The ceiling is at least one million iterations; SimC normally
stops at the target error. Actual achieved precision is saved in each row.
The executable is copied to a temporary file for the batch, protecting it from
replacement by the hourly engine updater. A result with a different recorded
SimC revision is rejected. This check occurs after the first simulation, so an
unavailable original engine can cost one simulation before failure.

On success a new completed Top Gear job contains the source report with the
selected rows' DPS, deltas, and precision replaced, then sorted by DPS. Other
rows and the original baseline remain as recorded. The result records its
source report, margin, target precision, and rerun names. The source report is
unchanged. Reconstruction metadata is copied so future row reruns work. No old
raw JSON, HTML, or text simulation output is attached to the combined report.
A failed or cancelled batch does not publish a partial combined report.

This narrows uncertainty around selected contenders; it does not guarantee the
best combination outside the selected margin was included. Engine revision
matching also cannot establish that every external data source stayed identical.

## Validation

- Backend unit tests: `cd backend && cargo test -p simhammer-core refine_handlers --lib --locked`
- Frontend checks: `cd frontend && npx tsc --noEmit && npm run test:topgear`
- Production server and static frontend builds.
- Live test against a SQLite backup in a separate Podman container on port 18000.
  A three-row fixture retained the top rough combination, highest precise
  combination, and baseline from the user's report. One real rerun replaced the
  rough number and reordered the copied report. The original fixture was
  unchanged, cancellation persisted, and the saved result and combination
  metadata survived restart. No production simulation was started by this test.

## Removing the feature

Base refinement and the Auto option are separate local commits. Revert the Auto
commit to remove only automatic selection. To remove refinement entirely, revert
the Auto commit and then the base refinement commit. Rebuild the server and
frontend after reverting, retaining the earlier UI customizations.
Existing copied reports contain ordinary gear-result data and remain readable.
The deployed local service mounts a compiled server and exported frontend; a Git
revert alone does not replace those running artifacts.
