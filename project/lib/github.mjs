import { execFileSync } from "node:child_process";

/**
 * Runs one GraphQL request through the gh CLI and returns the data member.
 * The query and variables travel on stdin as JSON, so nothing from an event
 * payload ever reaches a shell or the argument list.
 *
 * @param {string} query GraphQL document
 * @param {Object} variables GraphQL variables
 * @returns {Object} The data member of the response
 */
export function graphql(query, variables = {}) {
  const output = execFileSync("gh", ["api", "graphql", "--input", "-"], {
    input: JSON.stringify({ query, variables }),
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
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
