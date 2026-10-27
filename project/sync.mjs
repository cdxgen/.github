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
import { loadSchema } from "./lib/schema.mjs";
import { findProject, graphql } from "./lib/github.mjs";
import { createItemWriter } from "./lib/items.mjs";
import { parseClosingReferences } from "./lib/references.mjs";

const schema = loadSchema(process.argv.slice(2), process.env);
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
const { addToProject, currentValues, apply } = createItemWriter(
  project,
  schema,
  dryRun,
);

/**
 * Issues a pull request closes: the links GitHub recorded, plus the issues the
 * description names with a closing keyword. GitHub records no links for a pull
 * request aimed at a non-default branch, such as a release branch.
 */
function closedIssues(pr, repository) {
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
  const linked = data.node?.closingIssuesReferences?.nodes ?? [];
  const seen = new Set(linked.map((issue) => issue.id));
  const result = [...linked];
  for (const issueNumber of parseClosingReferences(pr.body)) {
    const found = graphql(
      `query($owner: String!, $name: String!, $number: Int!) {
         repository(owner: $owner, name: $name) {
           issue(number: $number) { id number state }
         }
       }`,
      { owner: repository.owner.login, name: repository.name, number: issueNumber },
    ).repository?.issue;
    if (found && !seen.has(found.id)) {
      seen.add(found.id);
      result.push(found);
    }
  }
  return result;
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
  const event = {
    action: payload.action,
    pullRequest: {
      draft: pr.draft,
      merged: pr.merged,
      open: pr.state === "open",
      labels: names(pr.labels),
    },
  };
  for (const linked of closedIssues(pr, payload.repository)) {
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
