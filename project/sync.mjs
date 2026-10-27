#!/usr/bin/env node
// Reflects one issue or pull request event onto the organization project.
//
// It runs inside the reusable workflow in .github/workflows/project-sync.yml
// and reads the event from GITHUB_EVENT_PATH. Every value from the event is
// used as data: it is looked up in the schema or sent as a GraphQL variable,
// and none of it is placed in a command line.
//
// Environment:
//   PROJECT_OWNER    organization that owns the project
//   PROJECT_NUMBER   project number; the script does nothing when it is empty
//   GH_TOKEN         token with write access to organization projects
//   DRY_RUN          set to 1 to print the changes without writing them

import { readFileSync } from "node:fs";
import process from "node:process";

import { decideForIssue, decideForPullRequest } from "./lib/decide.mjs";
import { findProject, graphql } from "./lib/github.mjs";

const schema = JSON.parse(
  readFileSync(new URL("./schema.json", import.meta.url), "utf8"),
);
const dryRun = process.env.DRY_RUN === "1";

const owner = process.env.PROJECT_OWNER;
const number = process.env.PROJECT_NUMBER;
if (!owner || !number) {
  console.log("PROJECT_OWNER or PROJECT_NUMBER is not set. Nothing to do.");
  process.exit(0);
}

const eventName = process.env.GITHUB_EVENT_NAME;
const payload = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));

const project = findProject(owner, { number });
if (!project) {
  console.error(`Project ${owner}/${number} was not found.`);
  process.exit(1);
}
const fieldsByName = new Map(project.fields.nodes.map((f) => [f.name, f]));
const selectFields = schema.fields
  .filter((f) => !f.dataType)
  .map((f) => f.name);

function addToProject(contentId) {
  const data = graphql(
    `mutation($project: ID!, $content: ID!) {
       addProjectV2ItemById(input: { projectId: $project, contentId: $content }) {
         item { id }
       }
     }`,
    { project: project.id, content: contentId },
  );
  return data.addProjectV2ItemById.item.id;
}

function currentValues(itemId) {
  const aliases = selectFields
    .map(
      (name, i) =>
        `f${i}: fieldValueByName(name: ${JSON.stringify(name)}) {
           ... on ProjectV2ItemFieldSingleSelectValue { name }
         }`,
    )
    .join("\n");
  const data = graphql(
    `query($item: ID!) { node(id: $item) { ... on ProjectV2Item { ${aliases} } } }`,
    { item: itemId },
  );
  const values = {};
  selectFields.forEach((name, i) => {
    values[name] = data.node?.[`f${i}`]?.name;
  });
  return values;
}

function apply(itemId, label, changes, values) {
  for (const { field, option, onlyIfUnset } of changes) {
    const definition = fieldsByName.get(field);
    const optionId = definition?.options?.find((o) => o.name === option)?.id;
    if (!optionId) {
      console.warn(`${label}: no option "${option}" on field "${field}".`);
      continue;
    }
    if (values[field] === option || (onlyIfUnset && values[field])) {
      continue;
    }
    console.log(`${label}: ${field} ${values[field] ?? "(unset)"} -> ${option}`);
    if (dryRun) {
      continue;
    }
    graphql(
      `mutation($project: ID!, $item: ID!, $field: ID!, $option: String!) {
         updateProjectV2ItemFieldValue(input: {
           projectId: $project, itemId: $item, fieldId: $field,
           value: { singleSelectOptionId: $option }
         }) { projectV2Item { id } }
       }`,
      {
        project: project.id,
        item: itemId,
        field: definition.id,
        option: optionId,
      },
    );
  }
}

const names = (labels) => (labels ?? []).map((l) => l.name);

if (eventName === "issues") {
  const { action, issue } = payload;
  const itemId = addToProject(issue.node_id);
  const values = currentValues(itemId);
  const event = {
    action,
    label: payload.label?.name,
    issue: { labels: names(issue.labels), state: issue.state },
  };
  apply(
    itemId,
    `issue #${issue.number}`,
    decideForIssue(event, { status: values.Status }, schema.labelFields),
    values,
  );
} else if (eventName === "pull_request_target" || eventName === "pull_request") {
  const pr = payload.pull_request;
  const data = graphql(
    `query($id: ID!) {
       node(id: $id) {
         ... on PullRequest {
           closingIssuesReferences(first: 20) { nodes { id number state } }
         }
       }
     }`,
    { id: pr.node_id },
  );
  const event = {
    action: payload.action,
    pullRequest: {
      draft: pr.draft,
      merged: pr.merged,
      labels: names(pr.labels),
    },
  };
  for (const linked of data.node?.closingIssuesReferences?.nodes ?? []) {
    const itemId = addToProject(linked.id);
    const values = currentValues(itemId);
    apply(
      itemId,
      `issue #${linked.number} via pull request #${pr.number}`,
      decideForPullRequest(
        event,
        { state: linked.state, status: values.Status },
        schema.labelFields,
      ),
      values,
    );
  }
} else {
  console.log(`Event ${eventName} is not handled.`);
}
