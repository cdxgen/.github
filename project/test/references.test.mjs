import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseClosingReferences } from "../lib/references.mjs";

describe("parseClosingReferences", () => {
  it("finds the keywords GitHub documents, in any case", () => {
    const body = "Closes #12\nfixes: #13, Resolved #14.";
    assert.deepEqual(parseClosingReferences(body), [12, 13, 14]);
  });

  it("ignores plain mentions, other repositories and non-numbers", () => {
    const body = "See #5. Closes other/repo#6 and fixes #abc and closes #";
    assert.deepEqual(parseClosingReferences(body), []);
  });

  it("ignores references inside fenced code blocks", () => {
    const body = "```\nCloses #99\n```\nRefs #100\nCloses #101";
    assert.deepEqual(parseClosingReferences(body), [101]);
  });

  it("returns each number once and tolerates an empty body", () => {
    assert.deepEqual(parseClosingReferences("Closes #3 and closes #3"), [3]);
    assert.deepEqual(parseClosingReferences(null), []);
    assert.deepEqual(parseClosingReferences(""), []);
  });
});
