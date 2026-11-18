# Onboarding the cdxgen organization to GitHub Actions lockfiles

| | |
| --- | --- |
| Epic | https://github.com/cdxgen/cdxgen/issues/4752 |
| Owner | @prabhu |
| AI use | Pair |
| Corpus | none |

## Why

Every active repository in the cdxgen organization runs its workflows from a GitHub Actions dependency lockfile (`.github/workflows/actions.lock`), Renovate keeps each lockfile and the inline SHA pins current, a required check verifies the lockfile on every pull request, and the organization's **Require lockfile** policy is on. All eight active repositories already pin every action to a full commit SHA; together they hold 54 workflows with 655 `uses:` references (repository survey taken for this plan). The lockfile adds what those pins cannot record: the transitive actions that composite actions call and the source repository's numeric identity.

GitHub Actions runs onboarded workflows from the commits recorded in `actions.lock` ([concept](https://docs.github.com/en/actions/concepts/security/workflow-dependency-lockfiles), [enforcement](https://docs.github.com/en/actions/how-tos/administer/enforce-workflow-lockfiles)). Renovate's `github-actions` manager regenerates the lockfile whenever it updates an action, so the organization keeps Renovate rather than moving to Dependabot. Six repositories call `cdxgen/.github/.github/workflows/project-sync.yml`, and once **Require lockfile** is active a caller is blocked when the reusable workflow it calls is not onboarded in its own repository, so cdxgen/.github is onboarded first.

The cdxgen feature work that reads lockfiles shipped for 13.7.0 and is tracked in cdxgen/cdxgen#4733; this rollout follows in 13.8.0. Once both have landed, cdxgen scans its own repository as a check that every workflow is onboarded.

## Scope

In scope:

- a shared Renovate preset in cdxgen/.github that regenerates `actions.lock` and moves `constraints.ghActionsLock` and the verify workflow's `gh-actions-lock` release together (D8)
- a reusable `verify-actions-lock.yml` workflow next to `project-sync.yml`, with a starter in `workflow-templates/` (D9)
- onboarding cdxgen/.github (D10) and cdxgen/cdxgen (D11), then caxa, cdx-hbom, cdx-proto, cdx-purl, cdxgen-plugins-bin and safer-exec (D12, one issue each)
- turning on the organization's **Require lockfile** policy once every repository is green (D13)

Out of scope:

- writing or regenerating lockfiles by hand; regeneration belongs to `gh actions-lock` and Renovate
- the cdxgen reader and audit feature itself, tracked in cdxgen/cdxgen#4733
- flipping the two organization policies; both need an organization owner (see Risks)

## Approach

The order of work follows cdxgen/cdxgen#4752: D8 sets up Renovate for lockfiles, D9 adds the shared verify workflow, cdxgen/.github (D10) and cdxgen/cdxgen (D11) follow, the other six repositories (D12) come in any order, and an organization owner turns on the policy last (D13).

Workflow files keep their inline SHA pins next to the lockfile, so each workflow stays pinned on its own and the lockfile adds transitive actions and repository identity on top. `gh actions-lock` leaves inline digests in place only when full-length SHA pins are required by policy, so an organization owner turns on **Require actions to be pinned to a full-length commit SHA** before the first repository is onboarded; Renovate then updates the digest in the workflow and the lock entry in the same pull request. The allowed-actions list is checked before the first onboarding pull request merges, and D13 needs an organization owner too.

Onboarding a repository means running `gh actions-lock`, committing the lockfile, adding `actions.lock` to CODEOWNERS, adding a `renovate.json` that extends the preset from D8, wiring the verify workflow from D9 as a required check, and moving the `project-sync.yml` pin to the cdxgen/.github commit that carries its lockfile. Reusable workflow calls, local or cross-repository, are job-level `uses:` and stay outside the lockfile, so callers pin them by commit SHA.

## Deliverables

### D8. Keep actions.lock current with Renovate across the organization

A shared preset in cdxgen/.github that every repository extends: `constraints.ghActionsLock` pinned to the same `gh-actions-lock` release as the verify workflow in D9, with a regex custom manager that moves both together; the GitHub Actions rules cdxgen's `renovate.json` has today, so the six repositories without an update bot get the same behaviour; and no change to digest pinning, since `helpers:pinGitHubActionDigests` stays on. Renovate installs `gh-actions-lock` at the version in `constraints.ghActionsLock` and runs it once per branch with `--no-interactive --no-onboard --no-narrow --ignore-local-actions --json=findings`, using its own GitHub token ([docs](https://docs.renovatebot.com/modules/manager/github-actions/), added in renovatebot/renovate#45199, with the relock fix in renovatebot/renovate#47294). No refresh workflow and no extra token with the workflows permission are needed. cdxgen's `renovate.json` switches to the preset, and each onboarding pull request adds a `renovate.json` that extends it. Finished when the SHA-pinning policy is on for the organization, the preset is merged in cdxgen/.github, and cdxgen/cdxgen extends it. Issue cdxgen/cdxgen#4741.

### D9. Reusable workflow that verifies actions.lock in every repository

A reusable workflow `verify-actions-lock.yml` in cdxgen/.github, next to `project-sync.yml`, plus a starter in `workflow-templates/`. It checks out with `persist-credentials: false`, installs `gh-actions-lock` pinned to the same release as `constraints.ghActionsLock` in the preset from D8 (v0.4.1 at the time of writing), and runs `gh actions-lock --verify` with `GH_TOKEN: ${{ github.token }}` and `contents: read`, as upstream's [verify-lockfile.yml](https://github.com/github/gh-actions-lock/blob/90ae563599cf303ff91eb5b46277ff04f5d2b4fc/.github/workflows/verify-lockfile.yml) does. It triggers on pull requests and pushes that touch `.github/workflows/**` or any `action.yml` or `action.yaml`, and becomes a required status check in each onboarded repository. The reusable workflow is itself locked in cdxgen/.github's lockfile, and every caller pins it by commit SHA, since the lockfile does not cover reusable workflow calls. Finished when the workflow runs green in cdxgen/.github and fails on a pull request that edits a `uses:` line without regenerating the lockfile. Issue cdxgen/cdxgen#4742.

### D10. Onboard cdxgen/.github

Run `gh actions-lock` in cdxgen/.github and commit `.github/workflows/actions.lock` for the three workflows (`project-backfill.yml`, `project-sync.yml`, `project-tests.yml`) and the verify workflow from D9. This repository goes first: six repositories call its `project-sync.yml`, and once **Require lockfile** is active a caller is blocked whenever the reusable workflow it calls is not onboarded in its own repository ([docs](https://docs.github.com/en/actions/how-tos/administer/control-workflow-execution#require-lockfile)). After the lockfile lands, callers move their SHA pin of `project-sync.yml` to the commit that carries it. The pull request adds `actions.lock` to CODEOWNERS (the repository has none yet) and a `renovate.json` that extends the preset from D8. Finished when the verify check passes on the default branch and a project-sync run from a caller succeeds against the new commit. Depends on cdxgen/cdxgen#4741 and cdxgen/cdxgen#4742. The organization's SHA-pinning policy from #4741 must be on before this runs, or `gh actions-lock` strips the inline pins. Issue cdxgen/cdxgen#4743.

### D11. Onboard cdxgen/cdxgen

Onboard all 26 workflows in cdxgen/cdxgen to `.github/workflows/actions.lock`. The composite action `.github/actions/generate-attach-sbom` calls `./.github/actions/build-docker-image`, which calls `docker/build-push-action`; `gh actions-lock` refuses that layout with a `local-action` error, so the run uses `--migrate-local-actions`, which rewrites `uses: ./...` to `uses: $/...` in workflows and `action.yml` files, and every rewritten line is reviewed, since `$/` runs the action at the workflow's own commit instead of from the workspace. The local reusable workflow `./.github/workflows/image-build.yml` and the cross-repository `project-sync.yml` call are job-level `uses:` and stay outside the lockfile; `project-sync.yml` moves to the commit from D10. Every external action is already SHA-pinned by Renovate and the pins stay (#4741), so with the organization's SHA-pinning policy on, the diff to `uses:` lines should be limited to the `$/` rewrites. `.github/CODEOWNERS` gains an entry for `actions.lock`, the verify check from D9 becomes required, and `renovate.json` extends the preset from D8. Before merging, a maintainer with org admin rights confirms the organization's allowed-actions list, which is matched against locked commits after onboarding, so entries written with a tag stop matching. As a self-check, a repository test scans cdxgen itself with `-t github` and asserts that every workflow reports `cdx:github:workflow:lockfileOnboarded=true` and that no pinning rule fires. Depends on cdxgen/cdxgen#4741, #4742 and #4743, and the SHA-pinning policy must be on before this runs. Issue cdxgen/cdxgen#4744.

### D12. Onboard caxa, cdx-hbom, cdx-proto, cdx-purl, cdxgen-plugins-bin and safer-exec (one issue each)

Each repository onboards its workflows with `gh actions-lock` in its own pull request: caxa, 2 workflows (cdxgen/cdxgen#4745), cdx-hbom, 3 (cdxgen/cdxgen#4746), cdx-proto, 2 (cdxgen/cdxgen#4747), cdx-purl, 2 (cdxgen/cdxgen#4748), cdxgen-plugins-bin, 13 (cdxgen/cdxgen#4749) and safer-exec, 4 (cdxgen/cdxgen#4750). All actions there are already SHA-pinned and the repositories have no update bot, so each pull request also adds a `renovate.json` that extends the preset from D8, calls the verify workflow from D9 pinned by commit, adds a CODEOWNERS entry for `actions.lock`, and moves the `project-sync.yml` pin to the cdxgen/.github commit that carries its lockfile, where the repository calls it. Each pull request closes its issue in its own repository. Finished when the verify check is required and green on the default branch in each repository. Depends on cdxgen/cdxgen#4741, #4742 and #4743, and the six pull requests have no order between them.

### D13. Turn on the Require lockfile Actions policy for the organization

Once every repository is onboarded and its verify check is green, an organization owner sets the organization's **Require lockfile** policy ([docs](https://docs.github.com/en/actions/how-tos/administer/control-workflow-execution#require-lockfile)), keeping **Require actions to be pinned to a full-length commit SHA** enabled alongside it, since workflow files keep their inline SHA pins. **Evaluate** mode is available only on GitHub Enterprise Cloud; without it the policy goes straight to **Active**, so `gh actions-lock --verify` runs in each repository on the day and the policy targets only the onboarded repositories. The allowed-actions list is reviewed at the same time, since tag-based entries stop matching locked workflows. New repositories need onboarding before they are added to the policy's targets. This needs an organization owner and cannot be done by an agent. Finished when the policy is active for all repositories and a week of runs shows no blocked workflow. Depends on cdxgen/cdxgen#4743, #4744 and #4745 to #4750. Issue cdxgen/cdxgen#4751.

## Risks and open questions

- The organization policy endpoints need the `admin:org` scope that the automation token lacks, so both the SHA-pinning policy, the prerequisite for onboarding (cdxgen/cdxgen#4741), and the **Require lockfile** policy (D13, cdxgen/cdxgen#4751) stay with the organization owner and cannot be done by an agent.
- `gh actions-lock` may rewrite inline pins when the policy is off: it leaves inline digests in place only when full-length SHA pins are required by policy, so onboarding before the policy is on strips the pins from the workflow files (cdxgen/cdxgen#4743, cdxgen/cdxgen#4744).
- The counts in the issue texts need care. cdxgen/cdxgen#4744 says all 26 workflows, but the `.github/workflows` directory holds 26 files of which one, `determine-rebuild-tags.js`, is a helper script, so there are 25 workflows. cdxgen/cdxgen#4747's text assumes cdx-proto calls `project-sync.yml`, but no workflow in that repository references it (code search returns no hits; the workflows are `ci.yml` and `npm-release.yml`), so the pin move in D12 applies only where a repository actually calls it.
- `--migrate-local-actions` rewrites `uses: ./...` to `uses: $/...`, which changes where the action runs from, the workflow's own commit instead of the workspace; each rewritten line is reviewed (cdxgen/cdxgen#4744).
- Reusable workflow calls (`image-build.yml`, `project-sync.yml`) stay outside the lockfile, so the required verify check and caller pins by commit SHA carry the protection for them (cdxgen/cdxgen#4742, cdxgen/cdxgen#4744).
- Renovate marks the lockfile regeneration experimental, and `constraints.ghActionsLock` must move with the verify workflow's `gh-actions-lock` release; the preset's custom manager moves both together (cdxgen/cdxgen#4741, cdxgen/cdxgen#4742).

## Outcome

All twelve issues are open as of 18 November 2026 and nothing of D8 to D13 has merged. The cdxgen-side feature work the rollout builds on shipped for 13.7.0 (see plans/cdxgen-actions-lockfile.md). This section records the deliverables as they land, starting with D8.
