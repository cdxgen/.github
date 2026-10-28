import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  decideForBackfill,
  decideForMilestoneClosedIssue,
  decideForMilestonePullRequest,
  decideForIssue,
  decideForPullRequest,
  pickLabelOption,
} from "../lib/decide.mjs";

const schema = JSON.parse(
  readFileSync(new URL("../schema.json", import.meta.url), "utf8"),
);
const { labelFields } = schema;

const issueEvent = (action, labels = [], label) => ({
  action,
  label,
  issue: { labels, state: action === "closed" ? "closed" : "open" },
});

const pullEvent = (action, extra = {}) => ({
  action,
  pullRequest: { draft: false, merged: false, labels: [], ...extra },
});

describe("pickLabelOption", () => {
  const map = labelFields.find((f) => f.field === "Area").map;

  it("prefers the label listed first in the mapping", () => {
    assert.equal(pickLabelOption(["lang:python", "lang:node"], map), "JavaScript");
  });

  it("returns undefined when no label is mapped", () => {
    assert.equal(pickLabelOption(["bug"], map), undefined);
  });
});

describe("decideForIssue", () => {
  it("sets Blocked when the blocked label is added", () => {
    const changes = decideForIssue(
      issueEvent("labeled", ["blocked"], "blocked"),
      { status: "Ready" },
      labelFields,
    );
    assert.deepEqual(changes, [
      { field: "Status", option: "Blocked", onlyIfUnset: false },
    ]);
  });

  it("returns a Blocked issue to Backlog when the label is removed", () => {
    const changes = decideForIssue(
      issueEvent("unlabeled", [], "blocked"),
      { status: "Blocked" },
      labelFields,
    );
    assert.equal(changes[0].option, "Backlog");
  });

  it("keeps another status when blocked is removed", () => {
    const changes = decideForIssue(
      issueEvent("unlabeled", [], "blocked"),
      { status: "Ready" },
      labelFields,
    );
    assert.equal(changes.some((c) => c.field === "Status"), false);
  });

  it("copies an area label to the Area field without touching Status", () => {
    const changes = decideForIssue(
      issueEvent("labeled", ["lang:go"], "lang:go"),
      { status: "Ready" },
      labelFields,
    );
    assert.deepEqual(changes, [
      { field: "Area", option: "Go", onlyIfUnset: false },
    ]);
  });
});

describe("decideForPullRequest", () => {
  const open = { state: "OPEN" };

  it("moves the linked issue to In review for a ready pull request", () => {
    assert.equal(
      decideForPullRequest(pullEvent("opened"), open, labelFields)[0].option,
      "In review",
    );
  });

  it("uses In progress while the pull request is a draft", () => {
    assert.equal(
      decideForPullRequest(pullEvent("opened", { draft: true }), open, labelFields)[0]
        .option,
      "In progress",
    );
    assert.equal(
      decideForPullRequest(pullEvent("converted_to_draft"), open, labelFields)[0]
        .option,
      "In progress",
    );
  });

  it("marks the issue Done on merge even when the issue stays open", () => {
    const changes = decideForPullRequest(
      pullEvent("closed", { merged: true }),
      open,
      labelFields,
    );
    assert.equal(changes[0].option, "Done");
  });

  it("returns the issue to Ready when its pull request is closed unmerged", () => {
    for (const status of ["In progress", "In review"]) {
      assert.equal(
        decideForPullRequest(pullEvent("closed"), { ...open, status }, labelFields)[0]
          .option,
        "Ready",
      );
    }
  });

  it("leaves Triage, Backlog and Blocked alone when a pull request closes unmerged", () => {
    for (const status of ["Triage", "Backlog", "Blocked", undefined]) {
      const changes = decideForPullRequest(
        pullEvent("closed"),
        { ...open, status },
        labelFields,
      );
      assert.equal(changes.some((c) => c.field === "Status"), false, String(status));
    }
  });

  it("keeps Blocked when a pull request is opened or made ready", () => {
    for (const action of ["opened", "reopened", "ready_for_review", "converted_to_draft"]) {
      const changes = decideForPullRequest(
        pullEvent(action),
        { ...open, status: "Blocked" },
        labelFields,
      );
      assert.equal(changes.some((c) => c.field === "Status"), false, action);
    }
  });

  it("still marks a Blocked issue Done when its pull request merges", () => {
    const changes = decideForPullRequest(
      pullEvent("closed", { merged: true }),
      { ...open, status: "Blocked" },
      labelFields,
    );
    assert.equal(changes[0].option, "Done");
  });

  it("does not reopen the status of an issue that is already closed", () => {
    const changes = decideForPullRequest(
      pullEvent("reopened"),
      { state: "CLOSED" },
      labelFields,
    );
    assert.equal(changes.some((c) => c.field === "Status"), false);
  });

  it("treats an edit of an open pull request like opening it", () => {
    assert.equal(
      decideForPullRequest(pullEvent("edited", { open: true }), open, labelFields)[0].option,
      "In review",
    );
    const closed = decideForPullRequest(pullEvent("edited", { open: false }), open, labelFields);
    assert.equal(closed.some((c) => c.field === "Status"), false);
  });

  it("only fills empty fields from pull request labels", () => {
    const changes = decideForPullRequest(
      pullEvent("opened", { labels: ["lang:go"] }),
      open,
      labelFields,
    );
    assert.deepEqual(changes[1], {
      field: "Area",
      option: "Go",
      onlyIfUnset: true,
    });
  });
});

describe("decideForBackfill", () => {
  it("sets Triage and Area only where nothing is set", () => {
    assert.deepEqual(decideForBackfill(["lang:rust"], labelFields), [
      { field: "Status", option: "Triage", onlyIfUnset: true },
      { field: "Area", option: "Rust", onlyIfUnset: true },
    ]);
  });
});

describe("decideForMilestonePullRequest", () => {
  const pr = (extra) => ({ draft: false, merged: false, labels: [], ...extra });

  it("marks a merged pull request Done unless it already is or is Blocked", () => {
    for (const status of [undefined, "Triage", "In review"]) {
      assert.equal(
        decideForMilestonePullRequest(pr({ merged: true }), status, labelFields)[0].option,
        "Done",
        String(status),
      );
    }
    for (const status of ["Done", "Blocked"]) {
      const changes = decideForMilestonePullRequest(pr({ merged: true }), status, labelFields);
      assert.equal(changes.some((c) => c.field === "Status"), false, status);
    }
  });

  it("moves an open pull request to In progress or In review from an early status", () => {
    assert.equal(
      decideForMilestonePullRequest(pr({ draft: true }), "Triage", labelFields)[0].option,
      "In progress",
    );
    assert.equal(
      decideForMilestonePullRequest(pr(), undefined, labelFields)[0].option,
      "In review",
    );
    assert.equal(
      decideForMilestonePullRequest(pr(), "In progress", labelFields)[0].option,
      "In review",
    );
  });

  it("keeps a status a person chose for an open pull request", () => {
    for (const status of ["Blocked", "Done", "In review"]) {
      const changes = decideForMilestonePullRequest(pr(), status, labelFields);
      assert.equal(changes.some((c) => c.field === "Status"), false, status);
    }
  });

  it("fills Area from the pull request labels only when empty", () => {
    const changes = decideForMilestonePullRequest(
      pr({ merged: true, labels: ["lang:go"] }),
      "Done",
      labelFields,
    );
    assert.deepEqual(changes, [{ field: "Area", option: "Go", onlyIfUnset: true }]);
  });
});

describe("decideForMilestoneClosedIssue", () => {
  it("marks a closed issue Done unless it is Done or Blocked", () => {
    for (const status of [undefined, "Triage", "Backlog", "In progress"]) {
      assert.equal(
        decideForMilestoneClosedIssue([], status, labelFields)[0].option,
        "Done",
        String(status),
      );
    }
    for (const status of ["Done", "Blocked"]) {
      assert.equal(decideForMilestoneClosedIssue([], status, labelFields).length, 0, status);
    }
  });
});
