# Plans

A plan is a markdown file that explains what we intend to build, why, and in what order. It lives in git so that its history is reviewable and its links stay valid. The status of the work lives on the [project board](../project/README.md), not in the plan.

Cross-repository plans go in this folder. A plan that concerns a single repository goes in a `plans/` folder in that repository, using the same template.

## One plan, one epic

Every plan has one epic issue in the repository that does most of the work. The epic uses the Epic issue type and the form in [ISSUE_TEMPLATE/epic.yml](../ISSUE_TEMPLATE/epic.yml). Each deliverable in the plan becomes a sub-issue of the epic, so the board shows progress as a count of finished sub-issues. See GitHub's documentation on [sub-issues](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/adding-sub-issues) and [issue types](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/managing-issue-types-in-an-organization).

The epic links to the plan with a permalink that names a commit, for example `https://github.com/cdxgen/.github/blob/<commit>/plans/example.md`, so the link still resolves after the file is edited. The plan links back to the epic in its header. The `Plan` field on the board holds the same permalink so that the roadmap views can show it.

## What goes where

| Kind of material | Where it lives |
| --- | --- |
| Intent, scope, risks, order of work | The plan file |
| Choices that should outlive the plan | A short decision record in `plans/decisions/NNNN-title.md` |
| Status, owner, priority, horizon | The board |
| Discussion and progress notes | Issue and pull request comments, which are not a durable record |
| What was actually learned or built | The plan's Outcome section, the pull request body and the commit message |
| Test corpora, recorded outputs, benchmark data | Outside the board, described in a corpus manifest (see below) |

Plans in a public repository are public. Write them the way you would write documentation: describe the work and the reasoning, and leave out internal chatter. Drafts that should not be public stay in a private repository until they are ready.

## Corpus manifests

Material that a plan depends on but that does not belong in git, such as large lockfiles, container images or recorded network traffic, is listed in a manifest named `<plan>.corpus.json` next to the plan. It follows [corpus-manifest.schema.json](corpus-manifest.schema.json). Each entry names the item, says where it came from, records a SHA-256 digest and the licence, and says where the bytes are stored.

Small files can stay in the repository under `test/data`. Larger files belong in release assets, an OCI artifact in GitHub Container Registry, or Git LFS. The plan and the issues refer to a corpus item by its digest, so a result can be reproduced from exactly the same input.

## Starting a plan

Copy [TEMPLATE.md](TEMPLATE.md), fill in the header, open the epic, and put the epic's number in the header. Open the pull request that adds the plan with `Refs #<epic>`, not `Closes`, since the epic stays open until the work is done.
