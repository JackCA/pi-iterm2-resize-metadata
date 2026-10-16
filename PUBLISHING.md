# Publishing

This repository uses Release Please to version the package, update the changelog, create immutable `vX.Y.Z` tags, and create GitHub Releases.

It does not publish to npm automatically. Git-tag installation remains the default distribution path.

## Release flow

1. Merge Conventional Commits into `main`.
2. The Release Please workflow creates or updates a release pull request.
3. Review the proposed version, `package.json`, lockfile, manifest, and changelog.
4. Merge the release pull request after CI passes.
5. Release Please creates the version tag and GitHub Release.
6. Verify installation from the immutable tag:

   ```bash
   pi install git:github.com/JackCA/pi-iterm2-resize-metadata@vX.Y.Z
   ```

The release manifest starts at `0.1.0` and uses the repository's tooling commit as its bootstrap boundary. Create the one-time `v0.1.0` tag when publishing the initial repository. Subsequent tags are automatic.

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

`npm run release:check` ensures the package version, Release Please manifest, package name, tag convention, and changelog agree.

## Optional npm publication

If npm publication is added later, use npm trusted publishing with provenance rather than a long-lived automation token. Publish only after the GitHub release gate succeeds, and verify that the npm version exactly matches the release tag.
