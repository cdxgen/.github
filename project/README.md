# cdxgen project board

The cdxgen organization tracks its work on one GitHub project, described in [schema.json](schema.json). The schema is the source of truth for the fields and views. [setup.mjs](setup.mjs) creates the project from it and [backfill.mjs](backfill.mjs) adds the issues that already exist. Day to day, the project's built-in workflows keep Status current, and an optional sync workflow covers the few cases they cannot. The reasoning for plans and epics is in [plans/README.md](../plans/README.md).

## Fields

Status says where an item is: Triage, Backlog, Ready, In progress, In review, Blocked or Done. Horizon (Now, Next, Later) and Priority (P0 to P2) are chosen by a maintainer and never touched by automation. Area follows the `lang:*` and topic labels. Plan holds the permalink of the plan document for an epic. The release an item is aimed at is the built-in Milestone field, so it stays tied to the repository's milestones. How much AI took part is not a field: the `ai-*` labels from [CONTRIBUTING.md](../CONTRIBUTING.md) already say so, and the Agent queue view filters on `label:ai-auto`.

## Built-in workflows

GitHub's built-in workflows need no token and no code, and they do most of the work. The GraphQL API can read them and delete them, but it cannot enable or configure them, so each board needs a one-time visit to the project menu, then Workflows. Pick a workflow, choose Edit, set the values below and choose "Save and turn on workflow". The documentation is [Using the built-in automations](https://docs.github.com/en/issues/planning-and-tracking-with-projects/automating-your-project/using-the-built-in-automations).

Item closed and Pull request merged are on from the start and set Status to Done. Turn on Item added to project with Status set to Triage, so every new item starts in the triage view. Turn on Pull request linked to issue with Status set to In progress, so an issue moves as soon as someone opens a pull request that closes it. If Item reopened is offered, set it to Backlog. Leave Auto-close issue on: moving an issue to Done on the board closes it.

Auto-add to project brings new issues in from a repository. Use the filter `is:issue is:open`. The limit is per plan, and each workflow targets one repository, so a Free organization can auto-add from one repository only and an Enterprise organization from up to twenty, see [Adding items automatically](https://docs.github.com/en/issues/planning-and-tracking-with-projects/automating-your-project/adding-items-automatically). Auto-add skips items that already exist, which is what the backfill is for.

## What the built-ins cannot do

A few rules need code. The optional sync handles them, and nothing else. The `blocked` label sets Status to Blocked, and removing it returns a Blocked issue to Backlog. Labels fill the Area field. A pull request to a branch other than the default, such as a backport to `release/12.0.x`, marks the issue it names Done when it merges, because GitHub records no closing link for such a pull request and the built-in Pull request merged workflow never reaches the issue. The sync reads closing keywords (`Closes #123`, `Fixes #123`) from the pull request description for that, accepting only issues of the same repository. A ready pull request moves its issue to In review, a draft moves it to In progress, and a pull request closed without merging returns an issue to Ready if the pull request had moved it. A person's choice of Blocked is kept throughout. The rules are in [lib/decide.mjs](lib/decide.mjs) and are covered by the tests in [test](test).

Only issues are added to the board. A pull request that closes no issue does not appear, and the `Closes` link is what connects the two.

## Setting it up

Authenticate `gh` with the `project` scope, then look at what would change:

```
gh auth refresh -s project
node project/setup.mjs
```

The first run only reads from GitHub. Add `--apply` to create the project, its fields, the views with their visible columns, the repository links, the Epic issue type and the `blocked` and `needs-decision` labels. Creating an issue type needs the `admin:org` scope, and changing a project's visibility needs an organization owner. The script reports either problem and carries on. Running it again is safe: it creates what is missing and updates what differs. It keeps any option that exists on the project but not in the schema unless `--allow-option-removal` is given, because removing an option clears that value from every item.

The GraphQL API can set a view's filter and visible columns but not its grouping, sorting or the column field of a board, so the schema's `note` entries list what to set by hand once, in the project's view menu. The API reference is [Using the API to manage Projects](https://docs.github.com/en/issues/planning-and-tracking-with-projects/automating-your-project/using-the-api-to-manage-projects), and view filters use the [project filter syntax](https://docs.github.com/en/issues/planning-and-tracking-with-projects/customizing-views-in-your-project/filtering-projects).

## Filling the board

Auto-add ignores items that exist already, so run the backfill once:

```
node project/backfill.mjs
node project/backfill.mjs --apply
```

It adds every open issue of the linked repositories in Triage and copies Area from labels. It never replaces a value someone has set, so it can be run again, and it adds one issue at a time, so a large repository takes several minutes.

With `--milestoned` it also adds the open and merged pull requests, and the closed issues, that have a milestone, as items of their own. A merged pull request or a closed issue becomes Done, a draft In progress and a ready pull request In review, and a Blocked or Done the board already has is kept. That is how a release or a codename that spans repositories, such as the AppThreat Pelorus work, shows its pull requests next to its issues. The [project-backfill workflow](../.github/workflows/project-backfill.yml) runs it every night for the cdxgen board, using the organization secret `PROJECT_TOKEN`, and another organization can run it the same way with `--schema`, which matters on the Free plan because it allows only one auto-add repository.

## Epics

Epics use an Epic issue type, which `setup.mjs` creates. The [Epic form](../ISSUE_TEMPLATE/epic.yml) is an organization default, but a repository that has its own `ISSUE_TEMPLATE` folder, as `cdxgen/cdxgen` does, ignores the organization's defaults. Copy `epic.yml` into that repository's `.github/ISSUE_TEMPLATE` folder, as described in [Creating a default community health file](https://docs.github.com/en/communities/setting-up-your-project-for-healthy-contributions/creating-a-default-community-health-file).

## Turning on the optional sync

The workflows' automatic token cannot write to an organization project, because the `permissions` block has no scope for Projects v2, so the sync needs a token of its own. Create one that can write to organization projects. A GitHub App with the organization Projects permission is the better choice, and a fine-grained personal access token with the same permission also works once the organization allows fine-grained tokens. Store it as the organization secret `PROJECT_TOKEN`, and store the project number as the organization variable `PROJECT_NUMBER`. See [Automating Projects using Actions](https://docs.github.com/en/issues/planning-and-tracking-with-projects/automating-your-project/automating-projects-using-actions).

Each repository then adds the [project-sync starter workflow](../workflow-templates/project-sync.yml), which calls the reusable workflow in [.github/workflows/project-sync.yml](../.github/workflows/project-sync.yml). The reusable workflow does not check out the calling repository, so it is safe to trigger from `pull_request_target`; the [GitHub Security Lab write-up](https://securitylab.github.com/resources/github-actions-preventing-pwn-requests/) explains the risk it avoids. Without the secret the workflow prints a message and does nothing. Two events for the same item can overlap, in which case the later write wins for that field; the rules are written so that this never loses a status a person chose. Issues of other repositories that call the starter are added to the board whether or not the repository is linked to the project, so add the starter only to the repositories that should appear.

Another organization keeps its own `project/schema.json` in its own `.github` repository and runs these same scripts. The scripts take the schema from `--schema <path>` or the `PROJECT_SCHEMA` variable, and the reusable workflow takes an optional `schema-repository` input that fetches `project/schema.json` from that repository. For example, `node project/setup.mjs --schema ../../owasp/.github/project/schema.json` prepares that organization's board.

To try the sync without writing, set `DRY_RUN=1` and run `node project/sync.mjs` with `GITHUB_EVENT_NAME` and `GITHUB_EVENT_PATH` pointing at a saved event payload.

## Tests

```
node --test "project/test/*.test.mjs"
```

The tests need only Node.js. The sync and backfill tests replace the `gh` command with a small stub, so they never contact GitHub.
