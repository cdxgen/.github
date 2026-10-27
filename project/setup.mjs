#!/usr/bin/env node
// Creates or updates the organization project described by schema.json.
//
//   node project/setup.mjs            print what would change, write nothing
//   node project/setup.mjs --apply    make the changes
//
// The script only adds and renames. It will not drop an option that exists on
// the project unless --allow-option-removal is given, because removing an
// option clears that value on every item that used it. Reading needs the
// read:project scope and writing needs the project scope, see
// https://docs.github.com/en/issues/planning-and-tracking-with-projects/automating-your-project/using-the-api-to-manage-projects

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import process from "node:process";

import { findProject, graphql } from "./lib/github.mjs";

const schema = JSON.parse(
  readFileSync(new URL("./schema.json", import.meta.url), "utf8"),
);
const apply = process.argv.includes("--apply");
const allowRemoval = process.argv.includes("--allow-option-removal");
const owner = schema.owner;

const say = (message) => console.log(`${apply ? "" : "[dry run] "}${message}`);

function toOptionInput(option, existing) {
  return {
    ...(existing ? { id: existing.id } : {}),
    name: option.name,
    color: option.color ?? "GRAY",
    description: option.description ?? "",
  };
}

function ensureProject() {
  let project = findProject(owner, { title: schema.title });
  if (project) {
    return project;
  }
  say(`create project "${schema.title}" in ${owner}`);
  if (!apply) {
    return undefined;
  }
  const org = graphql(`query($login: String!) { organization(login: $login) { id } }`, {
    login: owner,
  });
  const created = graphql(
    `mutation($owner: ID!, $title: String!) {
       createProjectV2(input: { ownerId: $owner, title: $title }) { projectV2 { id } }
     }`,
    { owner: org.organization.id, title: schema.title },
  );
  project = findProject(owner, { title: schema.title });
  if (!project) {
    throw new Error(`Created ${created.createProjectV2.projectV2.id} but cannot read it back.`);
  }
  return project;
}

function ensureSettings(project) {
  if (
    project.public !== schema.public ||
    (project.shortDescription ?? "") !== schema.shortDescription
  ) {
    say(`set visibility to ${schema.public ? "public" : "private"} and the short description`);
    if (apply) {
      graphql(
        `mutation($id: ID!, $public: Boolean!, $desc: String!) {
           updateProjectV2(input: { projectId: $id, public: $public, shortDescription: $desc }) {
             projectV2 { id }
           }
         }`,
        { id: project.id, public: schema.public, desc: schema.shortDescription },
      );
    }
  }
}

function ensureFields(project) {
  const byName = new Map(project.fields.nodes.map((f) => [f.name, f]));
  for (const wanted of schema.fields) {
    const existing = byName.get(wanted.name);
    if (wanted.dataType) {
      if (!existing) {
        say(`create field ${wanted.name} (${wanted.dataType})`);
        if (apply) {
          graphql(
            `mutation($project: ID!, $name: String!, $type: ProjectV2CustomFieldType!) {
               createProjectV2Field(input: { projectId: $project, name: $name, dataType: $type }) {
                 projectV2Field { ... on ProjectV2Field { id } }
               }
             }`,
            { project: project.id, name: wanted.name, type: wanted.dataType },
          );
        }
      }
      continue;
    }
    if (!existing) {
      say(`create field ${wanted.name} with ${wanted.options.length} options`);
      if (apply) {
        graphql(
          `mutation($project: ID!, $name: String!, $options: [ProjectV2SingleSelectFieldOptionInput!]) {
             createProjectV2Field(input: {
               projectId: $project, name: $name, dataType: SINGLE_SELECT, singleSelectOptions: $options
             }) { projectV2Field { ... on ProjectV2SingleSelectField { id } } }
           }`,
          {
            project: project.id,
            name: wanted.name,
            options: wanted.options.map((o) => toOptionInput(o)),
          },
        );
      }
      continue;
    }
    const have = existing.options ?? [];
    const haveByName = new Map(have.map((o) => [o.name, o]));
    const wantedNames = wanted.options.map((o) => o.name);
    const extra = have.filter((o) => !wantedNames.includes(o.name));
    const sameOrder =
      extra.length === 0 &&
      have.length === wantedNames.length &&
      have.every((o, i) => o.name === wantedNames[i]);
    if (sameOrder) {
      continue;
    }
    if (extra.length && !allowRemoval) {
      say(
        `field ${wanted.name} has options not in the schema (${extra
          .map((o) => o.name)
          .join(", ")}). Keeping them. Pass --allow-option-removal to drop them.`,
      );
    }
    const options = wanted.options.map((o) => toOptionInput(o, haveByName.get(o.name)));
    if (!allowRemoval) {
      options.push(...extra.map((o) => toOptionInput(o, o)));
    }
    say(`update options of ${wanted.name}`);
    if (apply) {
      graphql(
        `mutation($field: ID!, $options: [ProjectV2SingleSelectFieldOptionInput!]) {
           updateProjectV2Field(input: { fieldId: $field, singleSelectOptions: $options }) {
             projectV2Field { ... on ProjectV2SingleSelectField { id } }
           }
         }`,
        { field: existing.id, options },
      );
    }
  }
}

function ensureViews(project) {
  const fieldIds = new Map(
    findProject(owner, { title: schema.title }).fields.nodes.map((f) => [f.name, f.id]),
  );
  const data = graphql(
    `query($id: ID!) {
       node(id: $id) { ... on ProjectV2 { views(first: 50) { nodes { id name layout filter } } } }
     }`,
    { id: project.id },
  );
  const have = new Map(data.node.views.nodes.map((v) => [v.name, v]));
  for (const wanted of schema.views) {
    const existing = have.get(wanted.name);
    if (existing && (existing.filter ?? "") === wanted.filter) {
      continue;
    }
    say(`${existing ? "update filter of" : "create"} view ${wanted.name}`);
    if (!apply) {
      continue;
    }
    let viewId = existing?.id;
    if (!viewId) {
      const created = graphql(
        `mutation($project: ID!, $name: String!, $layout: ProjectV2ViewLayout!) {
           createProjectV2View(input: { projectId: $project, name: $name, layout: $layout }) {
             projectV2View { id }
           }
         }`,
        { project: project.id, name: wanted.name, layout: wanted.layout },
      );
      viewId = created.createProjectV2View.projectV2View.id;
    }
    graphql(
      `mutation($view: ID!, $filter: String!) {
         updateProjectV2View(input: { viewId: $view, filter: $filter }) { projectV2View { id } }
       }`,
      { view: viewId, filter: wanted.filter },
    );
    if (wanted.columns) {
      const ids = [];
      for (const column of wanted.columns) {
        if (fieldIds.has(column)) {
          ids.push(fieldIds.get(column));
        } else {
          console.warn(`view ${wanted.name}: no field named "${column}", skipping it.`);
        }
      }
      graphql(
        `mutation($view: ID!, $ids: [ID!]) {
           updateProjectV2View(input: { viewId: $view, configuration: { visibleFieldIds: $ids } }) {
             projectV2View { id }
           }
         }`,
        { view: viewId, ids },
      );
    }
  }
}

function ensureRepositories(project) {
  for (const slug of schema.repositories) {
    const [repoOwner, repoName] = slug.split("/");
    if (project.repositories?.nodes?.some((r) => r.nameWithOwner === slug)) {
      continue;
    }
    const data = graphql(
      `query($owner: String!, $name: String!) {
         repository(owner: $owner, name: $name) { id }
       }`,
      { owner: repoOwner, name: repoName },
    );
    say(`link ${slug} to the project`);
    if (apply) {
      graphql(
        `mutation($project: ID!, $repo: ID!) {
           linkProjectV2ToRepository(input: { projectId: $project, repositoryId: $repo }) {
             repository { id }
           }
         }`,
        { project: project.id, repo: data.repository.id },
      );
    }
  }
}

function ensureIssueTypes() {
  const have = JSON.parse(
    execFileSync("gh", ["api", `orgs/${owner}/issue-types`], { encoding: "utf8" }),
  ).map((t) => t.name);
  for (const type of schema.issueTypes) {
    if (have.includes(type.name)) {
      continue;
    }
    say(`create issue type ${type.name}`);
    if (apply) {
      execFileSync(
        "gh",
        [
          "api", `orgs/${owner}/issue-types`, "--method", "POST",
          "-f", `name=${type.name}`,
          "-f", `description=${type.description}`,
          "-f", `color=${type.color}`,
          "-F", "is_enabled=true",
        ],
        { stdio: "inherit" },
      );
    }
  }
}

function ensureLabels() {
  for (const slug of schema.repositories) {
    for (const label of schema.labels) {
      say(`label ${label.name} on ${slug}`);
      if (apply) {
        execFileSync(
          "gh",
          [
            "label", "create", label.name,
            "--repo", slug,
            "--color", label.color,
            "--description", label.description,
            "--force",
          ],
          { stdio: "inherit" },
        );
      }
    }
  }
}

const project = ensureProject();
if (project) {
  ensureSettings(project);
  ensureFields(project);
  ensureViews(project);
  ensureRepositories(project);
} else {
  say("fields, views and repository links follow once the project exists");
}
ensureIssueTypes();
ensureLabels();
if (!apply) {
  console.log("\nNothing was written. Run again with --apply to make these changes.");
}
