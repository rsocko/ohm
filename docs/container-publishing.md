# Container publishing

Ohm publishes a public container image to
[`ghcr.io/rsocko/ohm`](https://github.com/rsocko/ohm/pkgs/container/ohm).
Publication is handled by
[`.github/workflows/publish-container.yml`](../.github/workflows/publish-container.yml)
and is deliberately separate from
[`.github/workflows/ci.yml`](../.github/workflows/ci.yml): it never runs on a
`push` or `pull_request` event, and it only builds a commit that has already
passed CI.

## When publication runs

- **Automatic** — after the `CI` workflow completes successfully for a `push`
  to `main` in this repository (not a fork). The workflow checks out
  `origin/main`, verifies the completed run's exact `head_sha` is still an
  ancestor of `main`, and builds only that verified, detached commit — never
  a pull-request ref or a contributor-controlled branch.
- **Manual** (`workflow_dispatch`) — only when the workflow itself is
  dispatched from `main`, and only for a full lowercase 40-character commit
  SHA that a read-only job proves is an ancestor of `origin/main` before the
  privileged job repeats the same checkout and ancestry check and builds the
  exact commit. You choose `version_mode` (`explicit`, `next_major`,
  `next_minor`, or `next_patch`), an optional `image_tag` (required only for
  `explicit`), and whether to also promote `latest`.

Every publication is globally serialized (`concurrency: publish-container`,
`cancel-in-progress: false`) so semantic-version discovery from the registry
can never race another publication.

## Tag policy

- An **automatic** publication always reserves the next patch version (for
  example `0.2.0` → `0.2.1`; an empty/new registry starts at `0.1.0`), tags
  it `sha-<7-character-commit>`, and also promotes `latest`. Tags are
  unprefixed semantic versions (`0.1.0`, not `v0.1.0`).
- A **manual** publication does not add a SHA tag; it only ever creates the
  semantic-version tag you requested (or `image_tag` when
  `version_mode=explicit`), and promotes `latest` only if you asked for it.
- The workflow builds and pushes by digest first, attaches a BuildKit SBOM,
  and signs [GitHub build provenance](https://docs.github.com/en/actions/security-guides/using-artifact-attestations-to-establish-provenance-for-builds)
  for that exact digest **before** promoting it to any tag. It refuses to
  overwrite an existing immutable semantic-version or SHA tag, and after
  promotion it verifies every promoted tag (including `latest`) resolves back
  to the attested digest.

## Pulling the image

No sign-in is required — the package is public:

```sh
docker pull ghcr.io/rsocko/ohm:latest     # active development
docker pull ghcr.io/rsocko/ohm:0.1.0      # immutable semantic version
docker pull ghcr.io/rsocko/ohm:sha-abc1234 # immutable source commit
```

## Verifying attestations

Every published digest has a signed GitHub build provenance attestation.
Verify it with the [GitHub CLI](https://cli.github.com/):

```sh
gh attestation verify \
  oci://ghcr.io/rsocko/ohm@sha256:<digest> \
  --repo rsocko/ohm
```

## Rollback

Because `latest` is mutable, pin deployments to an immutable tag —
`sha-<7-character-commit>`, a semantic-version tag, or the full `sha256`
digest — and roll back by redeploying a previous immutable tag/digest rather
than relying on `latest`.

## One-time owner setup

The workflow can publish images, but it **cannot** change the package's
visibility — GitHub package visibility is a repository/organization setting,
not something an Actions token can set. A repository owner must, once:

1. Open the `ohm` package under the repository's **Packages** tab (or
   `https://github.com/rsocko/ohm/pkgs/container/ohm`).
2. **Connect the package to this repository**, if it isn't already linked.
3. Under package **Settings**, set visibility to **Public**.

No other configuration is required: the workflow uses the automatically
generated `GITHUB_TOKEN` (`packages: write`) for every publish, and no
personal access token, repository secret, or self-hosted runner is involved.
