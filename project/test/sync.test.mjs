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
function makeStub(directory, { currentStatus, linkedState = "OPEN", linkedNodes = true }) {
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
  const status = ${JSON.stringify(currentStatus ?? null)};
  data = { node: { f0: status ? { name: status } : null } };
} else if (q.includes("closingIssuesReferences")) {
  data = { node: { closingIssuesReferences: { nodes: ${linkedNodes} ? [{ id: "issue-node", number: 7, state: ${JSON.stringify(linkedState)} }] : [] } } };
} else if (q.includes("issue(number")) {
  data = { repository: { issue: { id: "issue-" + request.variables.number, number: request.variables.number, state: "OPEN" } } };
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

function run(eventName, payload, stubOptions = {}) {
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
  it("adds a new issue in Triage with its autonomy and area", () => {
    const writes = run("issues", {
      action: "opened",
      issue: {
        node_id: "issue-node",
        number: 7,
        state: "open",
        labels: [{ name: "ai-auto" }, { name: "lang:python" }],
      },
    });
    assert.deepEqual(
      writes.map((w) => w.option),
      ["option-Triage", "option-Auto", "option-Python"],
    );
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
});
