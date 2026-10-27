#!/usr/bin/env node
// Adds every open issue of the repositories linked in schema.json to the
// project, in Triage, with Autonomy and Area taken from labels. Values a
// person has already set are left alone, so running it again is safe.
//
//   node project/backfill.mjs [--project NUMBER]           print the changes
//   node project/backfill.mjs [--project NUMBER] --apply   make them
//
// The project is found by title unless a number is given. GitHub has no bulk
// add, so the script adds one issue at a time.

import { readFileSync } from "node:fs";
import process from "node:process";

import { decideForBackfill } from "./lib/decide.mjs";
import { findProject, graphql } from "./lib/github.mjs";
import { createItemWriter } from "./lib/items.mjs";

const schema = JSON.parse(
  readFileSync(new URL("./schema.json", import.meta.url), "utf8"),
);
const args = process.argv.slice(2);
const dryRun = !args.includes("--apply");
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
}
console.log(
  `${dryRun ? "[dry run] " : ""}${total} open issues processed.${
    dryRun ? " Run again with --apply to write." : ""
  }`,
);
