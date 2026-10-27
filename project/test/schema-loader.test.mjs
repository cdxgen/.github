import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { loadSchema } from "../lib/schema.mjs";

describe("loadSchema", () => {
  it("uses the bundled schema by default", () => {
    assert.equal(loadSchema([], {}).owner, "cdxgen");
  });

  it("prefers --schema, then PROJECT_SCHEMA, and fills optional members", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "schema-"));
    const file = path.join(directory, "schema.json");
    writeFileSync(file, JSON.stringify({ owner: "other", fields: [] }));
    const fromEnv = loadSchema([], { PROJECT_SCHEMA: file });
    assert.equal(fromEnv.owner, "other");
    assert.deepEqual(fromEnv.issueTypes, []);
    assert.deepEqual(fromEnv.labels, []);
    assert.equal(loadSchema(["--schema", file], {}).owner, "other");
  });
});
