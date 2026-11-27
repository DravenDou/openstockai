import fs from "node:fs";

// OpenAPI 3.1 schemas are JSON Schema. Zod resolves local refs through $defs.
const api = JSON.parse(fs.readFileSync("apps/api/openapi.json", "utf8"));
const normalize = value => JSON.parse(JSON.stringify(value).replaceAll("#/components/schemas/", "#/$defs/"));
const responses = {};
for (const [path, methods] of Object.entries(api.paths)) {
  for (const [method, operation] of Object.entries(methods)) {
    const schema = operation.responses?.["200"]?.content?.["application/json"]?.schema;
    if (schema) responses[`${method.toUpperCase()} ${path}`] = normalize(schema);
  }
}
fs.writeFileSync("packages/api-client/src/runtime.json", JSON.stringify({ definitions: normalize(api.components.schemas), responses }, null, 2) + "\n");
