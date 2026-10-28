/**
 * Rules that turn a GitHub event into project field changes. Nothing here
 * talks to the network, so every rule can be tested with plain objects.
 *
 * A change is { field, option, onlyIfUnset }. The caller applies it only when
 * the field is empty if onlyIfUnset is true, and always otherwise.
 */

/**
 * Picks the option a label set maps to. The order of keys in the mapping is
 * the order of precedence, so the first mapped label that is present wins.
 *
 * @param {string[]} labels Label names on the issue or pull request
 * @param {Object} mapping Label name to option name
 * @returns {string|undefined} Option name, or undefined when nothing matches
 */
export function pickLabelOption(labels, mapping) {
  const present = new Set(labels);
  for (const label of Object.keys(mapping)) {
    if (present.has(label)) {
      return mapping[label];
    }
  }
  return undefined;
}

/**
 * Field changes that come from labels alone, for example Area from the
 * lang:* labels.
 *
 * @param {string[]} labels Label names
 * @param {Object[]} labelFields The labelFields member of the schema
 * @param {boolean} onlyIfUnset Whether to leave a value a person already set
 * @returns {Object[]} Changes
 */
export function labelChanges(labels, labelFields, onlyIfUnset) {
  const changes = [];
  for (const { field, map } of labelFields) {
    const option = pickLabelOption(labels, map);
    if (option) {
      changes.push({ field, option, onlyIfUnset });
    }
  }
  return changes;
}

/**
 * Changes for a label event on an issue. The project's built-in workflows
 * already set Triage when an item is added and Done when an issue is closed,
 * so the only issue rules left are the ones they cannot express: the blocked
 * label sets Blocked, and labels fill the Area field.
 *
 * @param {Object} event { action, label, issue: { labels } }
 * @param {Object} current Current Status of the item, { status }
 * @param {Object[]} labelFields The labelFields member of the schema
 * @returns {Object[]} Changes
 */
export function decideForIssue(event, current, labelFields) {
  const changes = [];
  if (event.label === "blocked") {
    if (event.action === "labeled") {
      changes.push({ field: "Status", option: "Blocked", onlyIfUnset: false });
    } else if (event.action === "unlabeled" && current.status === "Blocked") {
      changes.push({ field: "Status", option: "Backlog", onlyIfUnset: false });
    }
  }
  return changes.concat(labelChanges(event.issue.labels, labelFields, false));
}

/**
 * Changes for a pull request event, applied to each issue the pull request
 * closes. A person's choice of Blocked is kept, and a closed pull request only
 * puts an issue back to Ready when the pull request itself had moved it. The
 * labels belong to the pull request and only fill empty fields, since the
 * issue's own labels are the stronger signal.
 *
 * @param {Object} event { action, pullRequest: { draft, merged, labels } }
 * @param {Object} linked The linked issue, { state, status }
 * @param {Object[]} labelFields The labelFields member of the schema
 * @returns {Object[]} Changes
 */
export function decideForPullRequest(event, linked, labelFields) {
  const { action, pullRequest } = event;
  const changes = [];
  const status = (option) =>
    changes.push({ field: "Status", option, onlyIfUnset: false });
  if (action === "closed" && pullRequest.merged) {
    status("Done");
  } else if (linked.state !== "CLOSED") {
    if (action === "closed") {
      if (["In progress", "In review"].includes(linked.status)) {
        status("Ready");
      }
    } else if (linked.status !== "Blocked") {
      if (action === "converted_to_draft") {
        status("In progress");
      } else if (action === "ready_for_review") {
        status("In review");
      } else if (
        action === "opened" ||
        action === "reopened" ||
        (action === "edited" && pullRequest.open)
      ) {
        // An edit can add the closing keyword after the pull request was
        // opened, so it is treated like opening one that is still open.
        status(pullRequest.draft ? "In progress" : "In review");
      }
    }
  }
  return changes.concat(labelChanges(pullRequest.labels, labelFields, true));
}

/**
 * Changes for an open issue that predates the board. Nothing a person has
 * already set is replaced, so the backfill can be run again safely.
 *
 * @param {string[]} labels Label names
 * @param {Object[]} labelFields The labelFields member of the schema
 * @returns {Object[]} Changes
 */
export function decideForBackfill(labels, labelFields) {
  return [
    { field: "Status", option: "Triage", onlyIfUnset: true },
    ...labelChanges(labels, labelFields, true),
  ];
}

const EARLY = [undefined, "Triage", "Backlog"];

/**
 * Changes for a pull request that carries a milestone and is kept on the board
 * as an item of its own, so a release or a codename that spans repositories
 * shows its pull requests next to its issues. A person's Blocked and a Done
 * the board already has are left alone.
 *
 * @param {Object} pr { draft, merged, labels }
 * @param {string|undefined} status Current Status of the item
 * @param {Object[]} labelFields The labelFields member of the schema
 * @returns {Object[]} Changes
 */
export function decideForMilestonePullRequest(pr, status, labelFields) {
  const changes = [];
  const set = (option) =>
    changes.push({ field: "Status", option, onlyIfUnset: false });
  if (pr.merged) {
    if (status !== "Done" && status !== "Blocked") {
      set("Done");
    }
  } else if (pr.draft) {
    if (EARLY.includes(status)) {
      set("In progress");
    }
  } else if ([...EARLY, "Ready", "In progress"].includes(status)) {
    set("In review");
  }
  return changes.concat(labelChanges(pr.labels, labelFields, true));
}
