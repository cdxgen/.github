import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const schema = JSON.parse(
  readFileSync(new URL("../schema.json", import.meta.url), "utf8"),
);
const colors = ["GRAY", "BLUE", "GREEN", "YELLOW", "ORANGE", "RED", "PINK", "PURPLE"];

describe("schema.json", () => {
  it("has unique field names and valid option colors", () => {
    const names = schema.fields.map((f) => f.name);
    assert.equal(new Set(names).size, names.length);
    for (const field of schema.fields) {
      for (const option of field.options ?? []) {
        assert.ok(colors.includes(option.color), `${field.name}/${option.name}`);
      }
    }
  });

  it("maps labels only to options that exist", () => {
    for (const { field, map } of schema.labelFields) {
      const options = schema.fields
        .find((f) => f.name === field)
        .options.map((o) => o.name);
      for (const [label, option] of Object.entries(map)) {
        assert.ok(options.includes(option), `${label} -> ${option}`);
      }
    }
  });

  it("defines every Status the sync rules can set", () => {
    const options = schema.fields
      .find((f) => f.name === "Status")
      .options.map((o) => o.name);
    for (const status of ["Triage", "Backlog", "Ready", "In progress", "In review", "Blocked", "Done"]) {
      assert.ok(options.includes(status), status);
    }
  });

  it("has unique view names", () => {
    const names = schema.views.map((v) => v.name);
    assert.equal(new Set(names).size, names.length);
  });
});
