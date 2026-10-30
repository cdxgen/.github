#!/usr/bin/env node
// Reflects the events that the project's built-in workflows cannot handle onto
// the organization project: the blocked label, labels that fill Area, pull
// requests to branches other than the default, whose closing keywords GitHub
// does not record, and the card a pull request has of its own, along with the
// milestone it takes from the issues it closes.
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
//   REPO_TOKEN       token that can set a pull request's milestone in the
//                    calling repository; without it no milestone is set
//   DRY_RUN          set to 1 to print the changes without writing them

import { readFileSync } from "node:fs";
import process from "node:process";

import {
  decideForIssue,
  decideForMilestonePullRequest,
  decideForPullRequest,
  inheritedMilestone,
} from "./lib/decide.mjs";
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
const { addToProject, findItem, currentValues, apply } = createItemWriter(
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
           closingIssuesReferences(first: 20) {
             nodes { id number state repository { id } milestone { id title } }
           }
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
           issue(number: $number) {
             id number state repository { id } milestone { id title }
           }
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
  // Only label changes matter here. The built-in workflows cover the rest.
  const { action, issue } = payload;
  if (action !== "labeled" && action !== "unlabeled") {
    console.log(`Issue action ${action} is handled by the built-in workflows.`);
    process.exit(0);
  }
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
  const issues = closedIssues(pr, payload.repository);
  for (const linked of issues) {
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
  syncPullRequestCard(pr, issues, event.pullRequest);
} else {
  console.log(`Event ${eventName} is not handled.`);
}

/**
 * Sets the milestone a pull request takes from the issues it closes, through
 * the repository's own token, since the project token need not reach the
 * repository. Returns the milestone the pull request has afterwards.
 */
function settleMilestone(pr, issues) {
  const own = pr.milestone
    ? { id: pr.milestone.node_id, title: pr.milestone.title }
    : undefined;
  const inherited = inheritedMilestone(own, issues, payload.repository?.node_id);
  if (!inherited) {
    return own;
  }
  const token = process.env.REPO_TOKEN;
  if (!token) {
    console.log(
      `pull request #${pr.number}: its issues are aimed at ${inherited.title}, but REPO_TOKEN is not set, so the milestone is left alone.`,
    );
    return own;
  }
  console.log(`pull request #${pr.number}: Milestone (unset) -> ${inherited.title}`);
  if (dryRun) {
    return inherited;
  }
  try {
    graphql(
      `mutation($pr: ID!, $milestone: ID!) {
         updatePullRequest(input: { pullRequestId: $pr, milestoneId: $milestone }) {
           pullRequest { id }
         }
       }`,
      { pr: pr.node_id, milestone: inherited.id },
      { token },
    );
  } catch (error) {
    console.warn(
      `pull request #${pr.number}: the milestone could not be set (${error.message}).`,
    );
    return own;
  }
  return inherited;
}

/**
 * Keeps the card a pull request has of its own in step, by the rules the
 * milestoned backfill uses. A pull request gets a card once it has a
 * milestone; one already on the board, however it got there, is updated too.
 */
function syncPullRequestCard(pr, issues, state) {
  const milestone = settleMilestone(pr, issues);
  const existing = findItem(pr.node_id);
  if (!milestone && !existing) {
    return;
  }
  const itemId = existing ?? addToProject(pr.node_id);
  const values = currentValues(itemId);
  apply(
    itemId,
    `pull request #${pr.number}`,
    decideForMilestonePullRequest(
      { ...state, closed: !state.open },
      values.Status,
      schema.labelFields,
    ),
    values,
  );
}
