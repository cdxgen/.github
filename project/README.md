# cdxgen project board

The cdxgen organization tracks its work on one GitHub project, described in [schema.json](schema.json). The schema is the source of truth: [setup.mjs](setup.mjs) creates the project from it, and [sync.mjs](sync.mjs) keeps item fields current as issues and pull requests change. The reasoning is in [plans/README.md](../plans/README.md) for plans and below for the board.

## Fields

Status says where an item is: Triage, Backlog, Ready, In progress, In review, Blocked or Done. Horizon (Now, Next, Later) and Priority (P0 to P2) are chosen by a maintainer and never touched by automation. Autonomy records how much AI took part, and follows the `ai-*` labels from [CONTRIBUTING.md](../CONTRIBUTING.md). Area follows the `lang:*` and topic labels. Plan holds the permalink of the plan document for an epic. The release an item is aimed at is the built-in Milestone field, so it stays tied to the repository's milestones.

## Who changes what

People own Horizon, Priority, milestones, epics and the move from Triage to Backlog or Ready. Automation owns the other Status changes and the fields derived from labels. An item changes status like this:

An issue enters the board as Triage when it is opened, or the first time anything happens on it. The `blocked` label moves it to Blocked and removing the label returns it to Backlog. A pull request that closes the issue (`Closes #123` in its body) moves the issue to In progress while the pull request is a draft and to In review once it is ready. Merging the pull request marks the issue Done. GitHub records no closing links for a pull request that targets a branch other than the default, such as a backport to `release/12.0.x`, so the sync also reads closing keywords (`Closes #123`, `Fixes #123`) from the pull request description and only accepts issues of the same repository. Editing the description of an open pull request runs the sync again, so a keyword added later is picked up. A person's choice of Blocked is kept while a pull request is opened or edited, and a pull request that is closed without merging only returns an issue to Ready if the pull request had moved it to In progress or In review. Closing an issue marks it Done and reopening a Done issue returns it to Backlog. The rules are in [lib/decide.mjs](lib/decide.mjs) and are covered by the tests in [test](test).

Only issues are added to the board. A pull request that closes no issue does not appear, and the `Closes` link is what connects the two. Agents are asked to link every pull request to an issue for that reason. Issues of the other cdxgen repositories (`cdxgen-plugins-bin`, `cdx-proto`, `cdx-purl` and so on) are added to the board when they call the starter workflow, whether or not the repository is linked to the project, so add the starter only to the repositories that should appear.

## Setting it up

Authenticate `gh` with the `project` scope, then look at what would change:

```
gh auth refresh -s project
node project/setup.mjs
```

The first run only reads from GitHub. Add `--apply` to create the project, its fields, the views with their visible columns, the repository links, the Epic issue type and the `blocked` and `needs-decision` labels. Creating an issue type needs a token that can administer the organization. Running it again is safe: it creates what is missing and updates what differs. It keeps any option that exists on the project but not in the schema unless `--allow-option-removal` is given, because removing an option clears that value from every item.

The GraphQL API can set a view's filter and visible columns but not its grouping, sorting or the column field of a board, so the schema's `note` entries list what to set by hand once, in the project's view menu. The API reference is [Using the API to manage Projects](https://docs.github.com/en/issues/planning-and-tracking-with-projects/automating-your-project/using-the-api-to-manage-projects), and view filters use the [project filter syntax](https://docs.github.com/en/issues/planning-and-tracking-with-projects/customizing-views-in-your-project/filtering-projects).

## Filling the board

The sync only touches an issue when something happens to it, so a new board starts empty. Right after `--apply`, run the backfill once:

```
node project/backfill.mjs
node project/backfill.mjs --apply
```

It adds every open issue of the linked repositories in Triage and copies Autonomy and Area from labels. It never replaces a value someone has set, so it can be run again.

## Epics

Epics use an Epic issue type, which `setup.mjs` creates. The [Epic form](../ISSUE_TEMPLATE/epic.yml) is an organization default, but a repository that has its own `ISSUE_TEMPLATE` folder, as `cdxgen/cdxgen` does, ignores the organization's defaults. Copy `epic.yml` into that repository's `.github/ISSUE_TEMPLATE` folder, as described in [Creating a default community health file](https://docs.github.com/en/communities/setting-up-your-project-for-healthy-contributions/creating-a-default-community-health-file).

## Turning on the sync

Create a token that can write to organization projects. A GitHub App with the organization Projects permission is the better choice, and a fine-grained personal access token with the same permission also works once the organization allows fine-grained tokens. Store it as the organization secret `PROJECT_TOKEN`, and store the project number as the organization variable `PROJECT_NUMBER`. See [Automating Projects using Actions](https://docs.github.com/en/issues/planning-and-tracking-with-projects/automating-your-project/automating-projects-using-actions).

Two events for the same item can overlap, in which case the later write wins for that field; the rules are written so that this never loses a status a person chose. Each repository then adds the [project-sync starter workflow](../workflow-templates/project-sync.yml), which calls the reusable workflow in [.github/workflows/project-sync.yml](../.github/workflows/project-sync.yml). The reusable workflow does not check out the calling repository, so it is safe to trigger from `pull_request_target`; the [GitHub Security Lab write-up](https://securitylab.github.com/resources/github-actions-preventing-pwn-requests/) explains the risk it avoids. Without the secret the workflow prints a message and does nothing.

To try the sync without writing, set `DRY_RUN=1` and run `node project/sync.mjs` with `GITHUB_EVENT_NAME` and `GITHUB_EVENT_PATH` pointing at a saved event payload.

## Tests

```
node --test project/test/
```

The tests need only Node.js. The sync tests replace the `gh` command with a small stub, so they never contact GitHub.
