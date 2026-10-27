import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

const schema = JSON.parse(
  readFileSync(new URL("../schema.json", import.meta.url), "utf8"),
);
const script = new URL("../backfill.mjs", import.meta.url).pathname;

describe("backfill.mjs", { skip: process.platform === "win32" }, () => {
  it("adds each open issue and writes only with --apply", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "project-backfill-"));
    const project = {
      id: "project-1",
      title: schema.title,
      fields: {
        nodes: schema.fields.map((f) => ({
          id: `field-${f.name}`,
          name: f.name,
          options: (f.options ?? []).map((o) => ({ id: `option-${o.name}`, name: o.name })),
        })),
      },
    };
    const log = path.join(directory, "calls.log");
    const stub = `#!/usr/bin/env node
const { appendFileSync, readFileSync } = require("node:fs");
const request = JSON.parse(readFileSync(0, "utf8"));
const q = request.query;
let data;
if (q.includes("projectsV2")) {
  data = { organization: { projectsV2: { nodes: [${JSON.stringify(project)}] } } };
} else if (q.includes("issues(first")) {
  data = { repository: { issues: { pageInfo: { hasNextPage: false, endCursor: null },
    nodes: [{ id: "i1", number: 1, labels: { nodes: [{ name: "lang:go" }] } },
            { id: "i2", number: 2, labels: { nodes: [] } }] } } };
} else if (q.includes("addProjectV2ItemById") && request.variables.content === "i2") {
  console.error("Content already exists in this project");
  process.exit(1);
} else if (q.includes("projectItems")) {
  data = { node: { projectItems: { nodes: [{ id: "item-existing", project: { id: "project-1" } }] } } };
} else if (q.includes("addProjectV2ItemById")) {
  appendFileSync(${JSON.stringify(log)}, "add " + request.variables.content + "\\n");
  data = { addProjectV2ItemById: { item: { id: "item-" + request.variables.content } } };
} else if (q.includes("fieldValueByName")) {
  data = { node: {} };
} else if (q.includes("updateProjectV2ItemFieldValue")) {
  appendFileSync(${JSON.stringify(log)}, "set " + request.variables.item + " " + request.variables.option + "\\n");
  data = { updateProjectV2ItemFieldValue: { projectV2Item: { id: "x" } } };
} else { console.error("unexpected " + q); process.exit(1); }
process.stdout.write(JSON.stringify({ data }));
`;
    const gh = path.join(directory, "gh");
    writeFileSync(gh, stub);
    chmodSync(gh, 0o755);
    const env = { ...process.env, PATH: `${directory}${path.delimiter}${process.env.PATH}` };

    const dry = execFileSync(process.execPath, [script], { env, encoding: "utf8" });
    assert.match(dry, /2 open issues processed/);
    assert.throws(() => readFileSync(log, "utf8"), /ENOENT/);

    execFileSync(process.execPath, [script, "--apply"], { env, encoding: "utf8" });
    const calls = readFileSync(log, "utf8").trim().split("\n");
    assert.deepEqual(calls, [
      "add i1",
      "set item-i1 option-Triage",
      "set item-i1 option-Go",
      "set item-existing option-Triage",
    ]);
  });
});
