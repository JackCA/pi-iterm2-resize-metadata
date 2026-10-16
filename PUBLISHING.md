# Publishing

This repository uses Release Please to version the package, update the changelog, create immutable `vX.Y.Z` tags, and create GitHub Releases.

Release Please also publishes completed releases to npm through npm Trusted Publishing. npm publication makes the package discoverable in the [Pi package gallery](https://pi.dev/packages).

## Release flow

1. Merge Conventional Commits into `main`.
2. The Release Please workflow creates or updates a release pull request.
3. Review the proposed version, `package.json`, lockfile, manifest, and changelog.
4. Merge the release pull request after CI passes.
5. Release Please creates the version tag and GitHub Release.
6. The same workflow verifies and publishes that exact version to npm through OIDC.
7. Verify both installation sources:

   ```bash
   pi install npm:pi-iterm2-resize-metadata
   pi install git:github.com/JackCA/pi-iterm2-resize-metadata@vX.Y.Z
   ```

The release manifest intentionally starts empty because it records versions that have already been released. The package configuration sets `initial-version` to `0.1.0` and uses the repository's release-automation commit as the bootstrap boundary. The first releasable Conventional Commit therefore opens the `v0.1.0` release pull request; merging it creates the initial tag and GitHub Release automatically. No manual bootstrap tag is required.

## Version rules

Release Please derives SemVer changes from Conventional Commits:

| Commit | Version effect |
|---|---|
| `fix: ...` | Patch |
| `feat: ...` | Minor |
| `feat!: ...` or a `BREAKING CHANGE:` footer | Major |
| `docs:`, `test:`, `ci:`, `chore:` | No release by default |

Examples:

```text
fix: preserve metadata when the redraw marker crosses writes
feat: support explicit terminal identity providers
feat!: require Pi 2.x
```

Lefthook validates local commit messages with Commitlint. Pull-request CI validates the PR title because repositories commonly squash-merge using that title.

## GitHub setup

In repository settings:

1. Allow GitHub Actions to create and approve pull requests.
2. Protect `main` and require the CI workflow.
3. Prefer a fine-grained token or GitHub App token stored as `RELEASE_PLEASE_TOKEN` with contents and pull-request write access. Events created with the default `GITHUB_TOKEN` may not start follow-up CI workflows.
4. Do not move or overwrite published version tags.

## Pre-release checks

```bash
npm ci
npm run check
```

`npm run release:check` validates both states: an empty pre-release manifest paired with `initial-version`, or a released manifest whose version agrees with the package and changelog. It also checks the package name and tag convention.

## npm trusted publishing

The first package version must be published manually because npm only allows trusted-publisher configuration after a package exists. Bootstrap from the exact released tag, not from an unreleased working tree:

```bash
git worktree add /tmp/pi-iterm2-resize-metadata-v0.1.0 v0.1.0
cd /tmp/pi-iterm2-resize-metadata-v0.1.0
npm ci
npm run check
npm publish --access public
```

Then configure the package's npm **Trusted Publisher**:

- Provider: GitHub Actions
- Organization or user: `JackCA`
- Repository: `pi-iterm2-resize-metadata`
- Workflow filename: `release-please.yml`
- Environment: leave blank

Future Release Please releases publish without an npm token. The publish job has only `contents: read` and `id-token: write`; npm automatically attaches provenance for the public GitHub repository. Do not add a long-lived `NPM_TOKEN`.
