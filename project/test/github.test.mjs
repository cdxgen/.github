import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

// Read once when github.mjs loads, so set it before the import.
process.env.GRAPHQL_RETRY_DELAY_MS = "1";
const { graphql, isTransientGhError } = await import("../lib/github.mjs");

describe("isTransientGhError", () => {
  it("repeats 5xx answers and secondary rate limits", () => {
    assert.equal(isTransientGhError("gh: HTTP 502\n"), true);
    assert.equal(isTransientGhError("gh: HTTP 503"), true);
    assert.equal(
      isTransientGhError("You have exceeded a secondary rate limit."),
      true,
    );
    assert.equal(isTransientGhError("was submitted too quickly"), true);
  });

  it("does not repeat errors about the request", () => {
    assert.equal(isTransientGhError("gh: HTTP 401"), false);
    assert.equal(isTransientGhError("gh: HTTP 404"), false);
    assert.equal(isTransientGhError("Content already exists in this project"), false);
    assert.equal(isTransientGhError(undefined), false);
  });
});

/**
 * Puts a stub gh on PATH that fails with `failure` for the first `failures`
 * calls and answers { data: { ok: true } } after that.
 */
function stubGh(failures, failure) {
  const directory = mkdtempSync(path.join(tmpdir(), "project-github-"));
  const counter = path.join(directory, "calls");
  writeFileSync(counter, "0");
  const stub = `#!/usr/bin/env node
const { readFileSync, writeFileSync } = require("node:fs");
readFileSync(0, "utf8");
const calls = Number(readFileSync(${JSON.stringify(counter)}, "utf8")) + 1;
writeFileSync(${JSON.stringify(counter)}, String(calls));
if (calls <= ${failures}) {
  console.error(${JSON.stringify(failure)});
  process.exit(1);
}
process.stdout.write(JSON.stringify({ data: { ok: true } }));
`;
  const gh = path.join(directory, "gh");
  writeFileSync(gh, stub);
  chmodSync(gh, 0o755);
  const previous = process.env.PATH;
  process.env.PATH = `${directory}${path.delimiter}${previous}`;
  return {
    calls: () => Number(readFileSync(counter, "utf8")),
    restore: () => {
      process.env.PATH = previous;
    },
  };
}

describe("graphql", { skip: process.platform === "win32" }, () => {
  it("tries a transient failure again and returns the data", () => {
    const gh = stubGh(2, "gh: HTTP 502");
    try {
      assert.deepEqual(graphql("query { ok }"), { ok: true });
      assert.equal(gh.calls(), 3);
    } finally {
      gh.restore();
    }
  });

  it("gives up after four attempts", () => {
    const gh = stubGh(10, "gh: HTTP 502");
    try {
      assert.throws(() => graphql("query { ok }"), /HTTP 502/);
      assert.equal(gh.calls(), 4);
    } finally {
      gh.restore();
    }
  });

  it("does not repeat a request GitHub rejected", () => {
    const gh = stubGh(1, "Content already exists in this project");
    try {
      assert.throws(() => graphql("query { ok }"), /already exists/);
      assert.equal(gh.calls(), 1);
    } finally {
      gh.restore();
    }
  });
});
