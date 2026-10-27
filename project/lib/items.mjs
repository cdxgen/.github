import { graphql } from "./github.mjs";

/**
 * Reads and writes items of one project. Writes are skipped when dryRun is
 * true, but every change is still reported.
 *
 * @param {Object} project Project with its fields, from findProject
 * @param {Object} schema The parsed schema.json
 * @param {boolean} dryRun Print changes without writing them
 * @returns {Object} addToProject, currentValues and apply
 */
export function createItemWriter(project, schema, dryRun) {
  const fieldsByName = new Map(project.fields.nodes.map((f) => [f.name, f]));
  const selectFields = schema.fields
    .filter((f) => !f.dataType)
    .map((f) => f.name);

  function addToProject(contentId) {
    if (dryRun) {
      return `dry-run-item-${contentId}`;
    }
    const data = graphql(
      `mutation($project: ID!, $content: ID!) {
         addProjectV2ItemById(input: { projectId: $project, contentId: $content }) {
           item { id }
         }
       }`,
      { project: project.id, content: contentId },
    );
    return data.addProjectV2ItemById.item.id;
  }

  function currentValues(itemId) {
    const values = {};
    if (dryRun && itemId.startsWith("dry-run-item-")) {
      return values;
    }
    const aliases = selectFields
      .map(
        (name, i) =>
          `f${i}: fieldValueByName(name: ${JSON.stringify(name)}) {
             ... on ProjectV2ItemFieldSingleSelectValue { name }
           }`,
      )
      .join("\n");
    const data = graphql(
      `query($item: ID!) { node(id: $item) { ... on ProjectV2Item { ${aliases} } } }`,
      { item: itemId },
    );
    selectFields.forEach((name, i) => {
      values[name] = data.node?.[`f${i}`]?.name;
    });
    return values;
  }

  function apply(itemId, label, changes, values) {
    for (const { field, option, onlyIfUnset } of changes) {
      const definition = fieldsByName.get(field);
      const optionId = definition?.options?.find((o) => o.name === option)?.id;
      if (!optionId) {
        console.warn(`${label}: no option "${option}" on field "${field}".`);
        continue;
      }
      if (values[field] === option || (onlyIfUnset && values[field])) {
        continue;
      }
      console.log(
        `${label}: ${field} ${values[field] ?? "(unset)"} -> ${option}`,
      );
      values[field] = option;
      if (dryRun) {
        continue;
      }
      graphql(
        `mutation($project: ID!, $item: ID!, $field: ID!, $option: String!) {
           updateProjectV2ItemFieldValue(input: {
             projectId: $project, itemId: $item, fieldId: $field,
             value: { singleSelectOptionId: $option }
           }) { projectV2Item { id } }
         }`,
        {
          project: project.id,
          item: itemId,
          field: definition.id,
          option: optionId,
        },
      );
    }
  }

  return { addToProject, currentValues, apply };
}
