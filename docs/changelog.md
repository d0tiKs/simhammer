# Changelog and build identity

The Changelog tab shows release notes from `frontend/src/data/changelog.json`, newest first. Add a version, ISO date, and a list of user-facing changes when preparing a release. The installed version comes from `frontend/package.json`.

The commit hash is embedded at frontend build time, so it identifies the bundled UI. Local and desktop builds read Git HEAD automatically. CI can supply `BUILD_COMMIT` or `GITHUB_SHA`. Published standalone images receive the exact workflow commit through the Docker build argument `BUILD_COMMIT`.

For local Docker Compose builds, pass the revision explicitly because Docker contexts exclude Git metadata:

```bash
BUILD_COMMIT=$(git rev-parse HEAD) docker compose --profile standalone build standalone
```

For a direct Docker build:

```bash
docker build --build-arg BUILD_COMMIT="$(git rev-parse HEAD)" -f Dockerfile.standalone .
```

The separate frontend image accepts the same build argument. Builds without a valid full commit hash show "Unavailable for this build" instead of guessing. The hash describes the committed source; it does not account for uncommitted local edits.
