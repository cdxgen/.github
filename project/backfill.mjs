#!/usr/bin/env node
// Adds every open issue of the repositories linked in schema.json to the
// project, in Triage, with Area taken from labels. Values a person has already
// set are left alone, so running it again is safe.
//
//   node project/backfill.mjs [--project NUMBER]           print the changes
//   node project/backfill.mjs [--project NUMBER] --apply   make them
//
// With --pull-requests it also adds the open and merged pull requests that
// have a milestone, so a release or a codename that spans repositories shows
// its pull requests next to its issues. They move to In progress, In review or
// Done to match the pull request.
//
// The project is found by title unless a number is given. GitHub has no bulk
// add, so the script adds one item at a time. Other options: --schema <path>.

import process from "node:process";

import {
  decideForBackfill,
  decideForMilestonePullRequest,
} from "./lib/decide.mjs";
import { loadSchema } from "./lib/schema.mjs";
import { findProject, graphql } from "./lib/github.mjs";
import { createItemWriter } from "./lib/items.mjs";

const schema = loadSchema(process.argv.slice(2), process.env);
const args = process.argv.slice(2);
const dryRun = !args.includes("--apply");
const withPullRequests = args.includes("--pull-requests");
const numberIndex = args.indexOf("--project");
const lookup =
  numberIndex >= 0
    ? { number: args[numberIndex + 1] }
    : { title: schema.title };

const project = findProject(schema.owner, lookup);
if (!project) {
  console.error("The project was not found. Run setup.mjs first.");
  process.exit(1);
}
const { addToProject, currentValues, apply } = createItemWriter(
  project,
  schema,
  dryRun,
);

let total = 0;
for (const slug of schema.repositories) {
  const [owner, name] = slug.split("/");
  let cursor = null;
  do {
    const page = graphql(
      `query($owner: String!, $name: String!, $cursor: String) {
         repository(owner: $owner, name: $name) {
           issues(first: 100, states: OPEN, after: $cursor) {
             pageInfo { hasNextPage endCursor }
             nodes { id number labels(first: 50) { nodes { name } } }
           }
         }
       }`,
      { owner, name, cursor },
    ).repository.issues;
    for (const issue of page.nodes) {
      const itemId = addToProject(issue.id);
      const values = currentValues(itemId);
      const labels = issue.labels.nodes.map((l) => l.name);
      apply(
        itemId,
        `${slug}#${issue.number}`,
        decideForBackfill(labels, schema.labelFields),
        values,
      );
      total += 1;
    }
    cursor = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
  } while (cursor);
  if (withPullRequests) {
    cursor = null;
    do {
      const page = graphql(
        `query($owner: String!, $name: String!, $cursor: String) {
           repository(owner: $owner, name: $name) {
             pullRequests(first: 100, states: [OPEN, MERGED], after: $cursor,
                          orderBy: { field: UPDATED_AT, direction: DESC }) {
               pageInfo { hasNextPage endCursor }
               nodes {
                 id number isDraft merged
                 milestone { title }
                 labels(first: 50) { nodes { name } }
               }
             }
           }
         }`,
        { owner, name, cursor },
      ).repository.pullRequests;
      for (const pr of page.nodes.filter((p) => p.milestone)) {
        const itemId = addToProject(pr.id);
        const values = currentValues(itemId);
        apply(
          itemId,
          `${slug}#${pr.number}`,
          decideForMilestonePullRequest(
            {
              draft: pr.isDraft,
              merged: pr.merged,
              labels: pr.labels.nodes.map((l) => l.name),
            },
            values.Status,
            schema.labelFields,
          ),
          values,
        );
        total += 1;
      }
      cursor = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
    } while (cursor);
  }
}
console.log(
  `${dryRun ? "[dry run] " : ""}${total} items processed.${
    dryRun ? " Run again with --apply to write." : ""
  }`,
);
