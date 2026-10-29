import { execFileSync } from "node:child_process";
import process from "node:process";

/**
 * How often a request is attempted when GitHub answers with a transient
 * error, and the first wait between attempts in milliseconds. The wait
 * doubles each time. GRAPHQL_RETRY_DELAY_MS overrides the wait, so the tests
 * need not sleep.
 */
const ATTEMPTS = 4;
const FIRST_DELAY_MS = Number(process.env.GRAPHQL_RETRY_DELAY_MS ?? 5000);

/**
 * True for a failure worth repeating: a 5xx answer, which GitHub's GraphQL
 * endpoint returns now and then under load (the nightly backfill died on one
 * HTTP 502), or a secondary rate limit, which asks the caller to wait.
 * Errors about the request itself, such as an item that already exists, are
 * not repeated.
 *
 * @param {string} stderr What gh printed on stderr
 * @returns {boolean} Whether to try again
 */
export function isTransientGhError(stderr) {
  const text = `${stderr ?? ""}`;
  for (const status of ["500", "502", "503", "504"]) {
    if (text.includes(`HTTP ${status}`)) {
      return true;
    }
  }
  const lower = text.toLowerCase();
  return (
    lower.includes("secondary rate limit") ||
    lower.includes("was submitted too quickly")
  );
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Runs one GraphQL request through the gh CLI and returns the data member.
 * The query and variables travel on stdin as JSON, so nothing from an event
 * payload ever reaches a shell or the argument list. A transient failure is
 * tried again with a growing wait; every mutation the scripts send sets a
 * value or adds an item that is skipped when present, so repeating one is
 * safe.
 *
 * @param {string} query GraphQL document
 * @param {Object} variables GraphQL variables
 * @returns {Object} The data member of the response
 */
export function graphql(query, variables = {}) {
  let output;
  for (let attempt = 1; ; attempt++) {
    try {
      output = execFileSync("gh", ["api", "graphql", "--input", "-"], {
        input: JSON.stringify({ query, variables }),
        encoding: "utf8",
        maxBuffer: 32 * 1024 * 1024,
      });
      break;
    } catch (error) {
      if (attempt >= ATTEMPTS || !isTransientGhError(error.stderr)) {
        throw error;
      }
      const delay = FIRST_DELAY_MS * 2 ** (attempt - 1);
      console.warn(
        `GitHub answered ${`${error.stderr}`.trim()}; trying again in ${delay} ms (attempt ${attempt + 1} of ${ATTEMPTS}).`,
      );
      sleep(delay);
    }
  }
  const response = JSON.parse(output);
  if (response.errors?.length) {
    throw new Error(response.errors.map((e) => e.message).join("; "));
  }
  return response.data;
}

const PROJECT_FIELDS = `
  id
  title
  public
  shortDescription
  repositories(first: 50) { nodes { nameWithOwner } }
  fields(first: 50) {
    nodes {
      ... on ProjectV2Field { id name dataType }
      ... on ProjectV2SingleSelectField {
        id
        name
        dataType
        options { id name color description }
      }
    }
  }
`;

/**
 * Finds an organization project by number or by exact title.
 *
 * @param {string} owner Organization login
 * @param {Object} lookup Either { number } or { title }
 * @returns {Object|undefined} The project with its fields, or undefined
 */
export function findProject(owner, lookup) {
  if (lookup.number) {
    const data = graphql(
      `query($owner: String!, $number: Int!) {
         organization(login: $owner) { projectV2(number: $number) { ${PROJECT_FIELDS} } }
       }`,
      { owner, number: Number(lookup.number) },
    );
    return data.organization?.projectV2 ?? undefined;
  }
  const data = graphql(
    `query($owner: String!) {
       organization(login: $owner) { projectsV2(first: 100) { nodes { ${PROJECT_FIELDS} } } }
     }`,
    { owner },
  );
  return data.organization?.projectsV2?.nodes?.find(
    (p) => p.title === lookup.title,
  );
}
