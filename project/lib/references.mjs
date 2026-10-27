const KEYWORDS = new Set([
  "close",
  "closes",
  "closed",
  "fix",
  "fixes",
  "fixed",
  "resolve",
  "resolves",
  "resolved",
]);

function stripFencedCode(body) {
  const kept = [];
  let inFence = false;
  for (const line of body.split("\n")) {
    if (line.trimStart().startsWith("```")) {
      inFence = !inFence;
    } else if (!inFence) {
      kept.push(line);
    }
  }
  return kept.join("\n");
}

function parseIssueNumber(token) {
  const trimmed = token.replace(/[.,;:)]+$/, "");
  if (!trimmed.startsWith("#") || trimmed.length < 2 || trimmed.length > 10) {
    return undefined;
  }
  const digits = trimmed.slice(1);
  for (const ch of digits) {
    if (ch < "0" || ch > "9") {
      return undefined;
    }
  }
  return Number(digits);
}

/**
 * Finds the issues of the same repository that a pull request body promises to
 * close, using the keywords GitHub documents in "Linking a pull request to an
 * issue". GitHub itself only records these links for pull requests that target
 * the default branch, so a backport to a release branch has none. Only
 * same-repository references of the form "Closes #123" are returned, and text
 * in fenced code blocks is ignored.
 *
 * @param {string|null|undefined} body Pull request description
 * @returns {number[]} Distinct issue numbers
 */
export function parseClosingReferences(body) {
  if (!body) {
    return [];
  }
  const tokens = stripFencedCode(body)
    .replaceAll("\r", " ")
    .replaceAll("\n", " ")
    .replaceAll("\t", " ")
    .split(" ")
    .filter(Boolean);
  const numbers = new Set();
  for (let i = 0; i < tokens.length - 1; i++) {
    const keyword = tokens[i].replace(/:$/, "").toLowerCase();
    if (KEYWORDS.has(keyword)) {
      const number = parseIssueNumber(tokens[i + 1]);
      if (number !== undefined) {
        numbers.add(number);
      }
    }
  }
  return [...numbers];
}
