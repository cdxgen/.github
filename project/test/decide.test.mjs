import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
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
  it("prefers the strongest autonomy label", () => {
    const map = labelFields.find((f) => f.field === "Autonomy").map;
    assert.equal(pickLabelOption(["ai-assist", "ai-auto"], map), "Auto");
  });

  it("returns undefined when no label is mapped", () => {
    const map = labelFields.find((f) => f.field === "Autonomy").map;
    assert.equal(pickLabelOption(["bug"], map), undefined);
  });
});

describe("decideForIssue", () => {
  it("puts a new issue in Triage and copies labels to fields", () => {
    const changes = decideForIssue(
      issueEvent("opened", ["ai-auto", "lang:go"]),
      {},
      labelFields,
    );
    assert.deepEqual(changes, [
      { field: "Status", option: "Triage", onlyIfUnset: true },
      { field: "Autonomy", option: "Auto", onlyIfUnset: false },
      { field: "Area", option: "Go", onlyIfUnset: false },
    ]);
  });

  it("marks a closed issue Done", () => {
    const changes = decideForIssue(issueEvent("closed"), {}, labelFields);
    assert.deepEqual(changes, [
      { field: "Status", option: "Done", onlyIfUnset: false },
    ]);
  });

  it("moves a reopened Done issue back to Backlog only", () => {
    assert.equal(
      decideForIssue(issueEvent("reopened"), { status: "Done" }, labelFields)[0]
        .option,
      "Backlog",
    );
    assert.equal(
      decideForIssue(issueEvent("reopened"), { status: "Ready" }, labelFields)[0]
        .onlyIfUnset,
      true,
    );
  });

  it("blocks on the blocked label and releases when it is removed", () => {
    const blocked = decideForIssue(
      issueEvent("labeled", ["blocked"], "blocked"),
      {},
      labelFields,
    );
    assert.equal(blocked[0].option, "Blocked");
    const released = decideForIssue(
      issueEvent("unlabeled", [], "blocked"),
      { status: "Blocked" },
      labelFields,
    );
    assert.equal(released[0].option, "Backlog");
  });

  it("leaves a status a person chose when an unrelated label changes", () => {
    const changes = decideForIssue(
      issueEvent("labeled", ["bug"], "bug"),
      { status: "Ready" },
      labelFields,
    );
    assert.deepEqual(changes, [
      { field: "Status", option: "Triage", onlyIfUnset: true },
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

  it("returns the issue to Ready when the pull request is closed unmerged", () => {
    assert.equal(
      decideForPullRequest(pullEvent("closed"), open, labelFields)[0].option,
      "Ready",
    );
  });

  it("does not reopen the status of an issue that is already closed", () => {
    const changes = decideForPullRequest(
      pullEvent("reopened"),
      { state: "CLOSED" },
      labelFields,
    );
    assert.equal(changes.some((c) => c.field === "Status"), false);
  });

  it("only fills empty fields from pull request labels", () => {
    const changes = decideForPullRequest(
      pullEvent("opened", { labels: ["ai-auto"] }),
      open,
      labelFields,
    );
    assert.deepEqual(changes[1], {
      field: "Autonomy",
      option: "Auto",
      onlyIfUnset: true,
    });
  });
});
