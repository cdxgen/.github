import { readFileSync } from "node:fs";

/**
 * Loads the project schema. A path given with --schema, or in the
 * PROJECT_SCHEMA environment variable, replaces the schema bundled next to the
 * scripts. That is how another organization keeps its own schema.json in its
 * own .github repository while running these scripts.
 *
 * @param {string[]} argv Command line arguments after the script name
 * @param {Object} env Environment variables
 * @returns {Object} The parsed schema
 */
export function loadSchema(argv, env) {
  const flag = argv.indexOf("--schema");
  const custom = flag >= 0 ? argv[flag + 1] : env.PROJECT_SCHEMA;
  const location = custom
    ? custom
    : new URL("../schema.json", import.meta.url);
  const schema = JSON.parse(readFileSync(location, "utf8"));
  schema.issueTypes ??= [];
  schema.labels ??= [];
  return schema;
}
