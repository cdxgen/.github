import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { describe, it } from "node:test";

const schema = JSON.parse(
  readFileSync(new URL("../schema.json", import.meta.url), "utf8"),
);
const syncScript = new URL("../sync.mjs", import.meta.url).pathname;

// A stand-in for the gh CLI. It answers the GraphQL documents sync.mjs sends
// from canned data and appends every write to a log file.
function makeStub(
  directory,
  {
    currentStatus,
    statusByItem = {},
    linkedState = "OPEN",
    linkedNodes = true,
    linkedMilestone = null,
    linkedRepository = "repo-node",
    prOnBoard = false,
  },
) {
  const project = {
    id: "project-1",
    fields: {
      nodes: schema.fields.map((f) => ({
        id: `field-${f.name}`,
        name: f.name,
        options: (f.options ?? []).map((o) => ({
          id: `option-${o.name}`,
          name: o.name,
        })),
      })),
    },
  };
  const source = `#!/usr/bin/env node
const { appendFileSync, readFileSync } = require("node:fs");
const request = JSON.parse(readFileSync(0, "utf8"));
const q = request.query;
const log = (entry) => appendFileSync(${JSON.stringify(path.join(directory, "writes.log"))}, JSON.stringify(entry) + "\\n");
let data;
if (q.includes("projectV2(number")) {
  data = { organization: { projectV2: ${JSON.stringify(project)} } };
} else if (q.includes("addProjectV2ItemById")) {
  data = { addProjectV2ItemById: { item: { id: "item-" + request.variables.content } } };
} else if (q.includes("fieldValueByName")) {
  const byItem = ${JSON.stringify(statusByItem)};
  const status = byItem[request.variables.item] ?? ${JSON.stringify(currentStatus ?? null)};
  data = { node: { f0: status ? { name: status } : null } };
} else if (q.includes("closingIssuesReferences")) {
  data = { node: { closingIssuesReferences: { nodes: ${linkedNodes} ? [{ id: "issue-node", number: 7, state: ${JSON.stringify(linkedState)}, repository: { id: ${JSON.stringify(linkedRepository)} }, milestone: ${JSON.stringify(linkedMilestone)} }] : [] } } };
} else if (q.includes("issue(number")) {
  data = { repository: { issue: { id: "issue-" + request.variables.number, number: request.variables.number, state: "OPEN", repository: { id: "repo-node" }, milestone: null } } };
} else if (q.includes("projectItems")) {
  data = { node: { projectItems: { nodes: ${prOnBoard} ? [{ id: "item-pr-node", project: { id: "project-1" } }] : [] } } };
} else if (q.includes("updatePullRequest")) {
  log({ ...request.variables, token: process.env.GH_TOKEN });
  data = { updatePullRequest: { pullRequest: { id: request.variables.pr } } };
} else if (q.includes("updateProjectV2ItemFieldValue")) {
  log(request.variables);
  data = { updateProjectV2ItemFieldValue: { projectV2Item: { id: request.variables.item } } };
} else {
  console.error("unexpected query: " + q);
  process.exit(1);
}
process.stdout.write(JSON.stringify({ data }));
`;
  const stub = path.join(directory, "gh");
  writeFileSync(stub, source);
  chmodSync(stub, 0o755);
}

function run(eventName, payload, stubOptions = {}, extraEnv = {}) {
  const directory = mkdtempSync(path.join(tmpdir(), "project-sync-"));
  makeStub(directory, stubOptions);
  const eventPath = path.join(directory, "event.json");
  writeFileSync(eventPath, JSON.stringify(payload));
  execFileSync(process.execPath, [syncScript], {
    env: {
      ...process.env,
      PATH: `${directory}${path.delimiter}${process.env.PATH}`,
      PROJECT_OWNER: "cdxgen",
      PROJECT_NUMBER: "1",
      GITHUB_EVENT_NAME: eventName,
      GITHUB_EVENT_PATH: eventPath,
      GH_TOKEN: "project-token",
      REPO_TOKEN: "",
      ...extraEnv,
    },
    stdio: "pipe",
  });
  let writes = [];
  try {
    writes = readFileSync(path.join(directory, "writes.log"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
  } catch {
    // No writes were made.
  }
  return writes;
}

describe("sync.mjs", { skip: process.platform === "win32" }, () => {
  it("sets Blocked when the blocked label is added", () => {
    const writes = run(
      "issues",
      {
        action: "labeled",
        label: { name: "blocked" },
        issue: { node_id: "issue-node", number: 7, state: "open", labels: [{ name: "blocked" }] },
      },
      { currentStatus: "Ready" },
    );
    assert.deepEqual(
      writes.map((w) => w.option),
      ["option-Blocked"],
    );
  });

  it("leaves issue opened, closed and reopened to the built-in workflows", () => {
    for (const action of ["opened", "closed", "reopened"]) {
      const writes = run("issues", {
        action,
        issue: { node_id: "issue-node", number: 7, state: "open", labels: [{ name: "lang:python" }] },
      });
      assert.equal(writes.length, 0, action);
    }
  });

  it("does nothing without a project number", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "project-sync-"));
    const output = execFileSync(process.execPath, [syncScript], {
      env: { ...process.env, PROJECT_OWNER: "cdxgen", PROJECT_NUMBER: "" },
      encoding: "utf8",
      cwd: directory,
    });
    assert.match(output, /Nothing to do/);
  });

  it("moves the issue a pull request closes to In review", () => {
    const writes = run(
      "pull_request_target",
      {
        action: "opened",
        pull_request: { node_id: "pr-node", number: 9, draft: false, merged: false, labels: [] },
      },
      { currentStatus: "Ready" },
    );
    assert.deepEqual(
      writes.map((w) => w.option),
      ["option-In review"],
    );
  });

  it("marks the issue Done when the pull request merges", () => {
    const writes = run(
      "pull_request_target",
      {
        action: "closed",
        pull_request: { node_id: "pr-node", number: 9, draft: false, merged: true, labels: [] },
      },
      { currentStatus: "In review" },
    );
    assert.deepEqual(
      writes.map((w) => w.option),
      ["option-Done"],
    );
  });

  it("skips a write when the status is already right", () => {
    const writes = run(
      "pull_request_target",
      {
        action: "ready_for_review",
        pull_request: { node_id: "pr-node", number: 9, draft: false, merged: false, labels: [] },
      },
      { currentStatus: "In review" },
    );
    assert.equal(writes.length, 0);
  });

  it("finds the issue from the body of a pull request to a release branch", () => {
    const writes = run(
      "pull_request_target",
      {
        action: "closed",
        repository: { name: "cdxgen", owner: { login: "cdxgen" } },
        pull_request: {
          node_id: "pr-node",
          number: 9,
          draft: false,
          merged: true,
          labels: [],
          body: "Backport.\n\nFixes #42",
        },
      },
      { currentStatus: "In review", linkedNodes: false },
    );
    assert.deepEqual(
      writes.map((w) => [w.item, w.option]),
      [["item-issue-42", "option-Done"]],
    );
  });

  it("keeps a Blocked issue Blocked when a pull request is opened", () => {
    const writes = run(
      "pull_request_target",
      {
        action: "opened",
        pull_request: { node_id: "pr-node", number: 9, draft: false, merged: false, labels: [] },
      },
      { currentStatus: "Blocked" },
    );
    assert.equal(writes.length, 0);
  });

  const release = { id: "milestone-13.6", title: "13.6.0" };
  const openPullRequest = (extra = {}) => ({
    action: "opened",
    repository: { node_id: "repo-node", name: "cdxgen", owner: { login: "cdxgen" } },
    pull_request: {
      node_id: "pr-node",
      number: 9,
      state: "open",
      draft: false,
      merged: false,
      labels: [],
      milestone: null,
      ...extra,
    },
  });

  it("gives a pull request the milestone of the issue it closes, with the repository token", () => {
    const writes = run(
      "pull_request_target",
      openPullRequest(),
      { currentStatus: "Ready", statusByItem: { "item-pr-node": "Triage" }, linkedMilestone: release },
      { REPO_TOKEN: "repo-token" },
    );
    assert.deepEqual(writes, [
      { project: "project-1", item: "item-issue-node", field: "field-Status", option: "option-In review" },
      { pr: "pr-node", milestone: "milestone-13.6", token: "repo-token" },
      { project: "project-1", item: "item-pr-node", field: "field-Status", option: "option-In review" },
    ]);
  });

  it("leaves the milestone and the card alone without the repository token", () => {
    const writes = run(
      "pull_request_target",
      openPullRequest(),
      { currentStatus: "Ready", linkedMilestone: release },
    );
    assert.deepEqual(
      writes.map((w) => w.item ?? w.pr),
      ["item-issue-node"],
    );
  });

  it("takes no milestone from an issue of another repository", () => {
    const writes = run(
      "pull_request_target",
      openPullRequest(),
      { currentStatus: "Ready", linkedMilestone: release, linkedRepository: "other-repo" },
      { REPO_TOKEN: "repo-token" },
    );
    assert.equal(writes.some((w) => w.milestone), false);
  });

  it("moves the card of a pull request that is already on the board", () => {
    const writes = run(
      "pull_request_target",
      openPullRequest(),
      { currentStatus: "Ready", statusByItem: { "item-pr-node": "Backlog" }, prOnBoard: true },
    );
    assert.deepEqual(
      writes.map((w) => [w.item, w.option]),
      [
        ["item-issue-node", "option-In review"],
        ["item-pr-node", "option-In review"],
      ],
    );
  });

  it("puts a milestoned pull request on the board as a draft in progress", () => {
    const writes = run(
      "pull_request_target",
      { ...openPullRequest({ draft: true, milestone: { node_id: "milestone-13.6", title: "13.6.0" } }), action: "milestoned" },
      { linkedNodes: false },
    );
    assert.deepEqual(
      writes.map((w) => [w.item, w.option]),
      [["item-pr-node", "option-In progress"]],
    );
  });

  it("adds no card for a pull request without a milestone", () => {
    const writes = run(
      "pull_request_target",
      openPullRequest(),
      { currentStatus: "Ready" },
    );
    assert.deepEqual(
      writes.map((w) => w.item),
      ["item-issue-node"],
    );
  });

  it("leaves the card of a pull request closed without merging to the built-in workflow", () => {
    const writes = run(
      "pull_request_target",
      { ...openPullRequest({ state: "closed" }), action: "closed" },
      { currentStatus: "Ready", statusByItem: { "item-pr-node": "In review" }, prOnBoard: true, linkedNodes: false },
    );
    assert.equal(writes.length, 0);
  });
});

