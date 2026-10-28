# Local Top Gear triage calibration

The calibration CLI runs the triage stage over a grid of batch sizes, iteration
counts, and cutoff multipliers. It reads one captured Top Gear
`NormalizedRequest` envelope, measures runtime, and optionally counts missing
baseline combinations among the survivors.

It does not benchmark the full staged pipeline, build an oracle, or accept raw
addon fixtures. There are no `--mode`, `--runs`, `--strategies`, or `--data-dir`
options. Raw fixtures and saved pipeline results in `scenarios/` are historical
artifacts; the current CLI cannot reproduce those workflows. `stub.json` is a
placeholder, not a runnable scenario.

## Capture a scenario

1. Configure and start a Top Gear simulation large enough to use the streaming path.
2. Read its normalized request from the server database:

```sql
SELECT request_json FROM jobs WHERE id = '<job-id>';
```

3. Save the JSON value as `backend/calibration/scenarios/captured-topgear.json`.

The request must contain `payload.base_profile`, `payload.options`, and
`payload.estimate`, as well as the combination-generator data captured by the
server. The estimate controls survivor budgeting. An addon export or raw API
request is not a substitute for this envelope.

Capture scenarios with both large gear differences and small gem/enchant
variations. They exercise different pruning behavior. Keep the captured request
and engine revision fixed when comparing grid results.

## Optional baseline

Save a baseline JSON containing the reference combinations to check:

```json
{
  "top_10": [
    { "combo_name": "Combo 12345" },
    { "combo_name": "Combo 67890" }
  ]
}
```

The CLI also accepts `top` instead of `top_10`. Matching uses only `combo_name`;
`combo_key`, `identity_key`, and DPS fields are ignored. Eager and streaming
paths may assign different names to identical gear, so name matching cannot
establish content-based recall across those paths. Check that baseline names
refer to the same combinations in the captured scenario.

## Run the grid

From the repository root, after saving a captured scenario and optional baseline:

```bash
cd backend
cargo run --release --locked -p simhammer-calibration -- \
  calibration/scenarios/captured-topgear.json \
  --baseline calibration/scenarios/captured-topgear.baseline.json \
  --simc-bin /absolute/path/to/simc \
  --batch-profilesets 100,250,500,1000 \
  --out calibration/scenarios/captured-topgear.calibration.json
```

Replace the engine path with a compatible installed binary. Omit `--baseline`
when no reference is available. `--simc-bin` defaults to `simc` on `PATH`.
Without `--out`, the CLI replaces the scenario's extension with
`.calibration.json`.

The default grid has 36 points: four batch sizes, iteration counts of 25, 50,
and 100, and cutoff multipliers of 2, 3, and 4. Only the batch-size axis is
configurable through the CLI. Run the command again with a different output
filename to collect repeated measurements.

Inspect the supported arguments without running simulations:

```bash
cargo run --locked -p simhammer-calibration -- --help
```

## Read results

The output is a JSON array with one object per grid point:

| Field | Meaning |
|-------|---------|
| `batch_profilesets` | Configured profilesets per SimC invocation |
| `triage_iterations` | Iteration count for this point |
| `triage_cutoff_multiplier` | Retention cutoff multiplier |
| `end_to_end_seconds` | Total wall time for this grid point |
| `average_batch_seconds` | Average batch wall time |
| `profilesets_per_second` | Measured throughput |
| `seconds_per_1000_profilesets` | Runtime normalized to 1,000 profilesets |
| `triage_survivors` | Number of surviving combinations |
| `total_batches` | Number of triage batches |
| `total_candidates` | Candidate count reported by triage |
| `total_accepted` | Accepted count reported by triage |
| `winner_loss_count` | Missing baseline entries by name, or null without a usable baseline |
| `notes` | Additional information or a `FAILED:` diagnostic |

Check `notes` before interpreting timings. A failed point is recorded with zero
metrics and a `FAILED:` note; the CLI can still write the array and exit
successfully. Zero runtime therefore does not establish a fast result.

A `winner_loss_count` of zero means the named baseline entries survived triage.
It does not measure final DPS regret or validate the later staged pipeline.
Compare repeated runs on both scenario types before changing production defaults.
