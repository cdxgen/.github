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
 * Field changes that come from labels alone, for example Autonomy from the
 * ai-* labels.
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
 * Changes for an event on an issue.
 *
 * @param {Object} event { action, label, issue: { labels, state } }
 * @param {Object} current Current Status of the item, { status }
 * @param {Object[]} labelFields The labelFields member of the schema
 * @returns {Object[]} Changes
 */
export function decideForIssue(event, current, labelFields) {
  const labels = event.issue.labels;
  const changes = [];
  switch (event.action) {
    case "closed":
      changes.push({ field: "Status", option: "Done", onlyIfUnset: false });
      break;
    case "reopened":
      if (current.status === "Done") {
        changes.push({
          field: "Status",
          option: "Backlog",
          onlyIfUnset: false,
        });
      }
      break;
    case "labeled":
      if (event.label === "blocked") {
        changes.push({
          field: "Status",
          option: "Blocked",
          onlyIfUnset: false,
        });
      }
      break;
    case "unlabeled":
      if (event.label === "blocked" && current.status === "Blocked") {
        changes.push({
          field: "Status",
          option: "Backlog",
          onlyIfUnset: false,
        });
      }
      break;
    default:
      break;
  }
  if (!changes.some((c) => c.field === "Status")) {
    // Any event on an issue that has no status yet places it in Triage. This
    // also backfills issues that were opened before the board existed.
    changes.push({ field: "Status", option: "Triage", onlyIfUnset: true });
  }
  const fromLabels = ["opened", "labeled", "unlabeled"].includes(event.action);
  return changes.concat(labelChanges(labels, labelFields, !fromLabels));
}

/**
 * Changes for a pull request event, applied to each issue the pull request
 * closes. The labels belong to the pull request and only fill empty fields,
 * since the issue's own labels are the stronger signal.
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
      status("Ready");
    } else if (action === "converted_to_draft") {
      status("In progress");
    } else if (action === "ready_for_review") {
      status("In review");
    } else if (action === "opened" || action === "reopened") {
      status(pullRequest.draft ? "In progress" : "In review");
    }
  }
  return changes.concat(labelChanges(pullRequest.labels, labelFields, true));
}
