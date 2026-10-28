# Contributing

Keep each PR focused on one concern. Separate formatting-only changes from
functional changes, and work on a branch rather than committing to `master`.

For setup, see [Development](docs/development.md).

## Checks

Run from the repository root before pushing:

```bash
bash scripts/verify.sh
```

The gate checks Rust formatting, Clippy, backend tests, frontend formatting,
ESLint, TypeScript, translations, and frontend/desktop unit tests. Missing tools
or game data are reported as skipped, not passed. Backend tests need compacted
game data; frontend talent tests need `backend/resources/data/talents.json`.

Useful subsets:

```bash
bash scripts/verify.sh --fast       # formatting and unit tests
bash scripts/verify.sh --frontend   # also accepts --rust and --desktop
```

Enable the fast gate before each commit:

```bash
git config core.hooksPath hooks
```

CI runs on PRs to `master` and `dev`. [lint.yml](.github/workflows/lint.yml)
covers formatting, linting, and Rust tests; [test.yml](.github/workflows/test.yml)
covers TypeScript, translations, and frontend/desktop tests.

## Formatting

```bash
cd frontend && npm run format
```

```bash
cd backend && cargo fmt --all
```

Use `npm run lint` in `frontend/` for ESLint. Use
`cargo clippy --all-targets --all-features -- -D warnings` in `backend/` for Rust linting.
