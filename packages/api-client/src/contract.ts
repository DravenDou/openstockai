import { z } from "zod";
import contract from "./runtime.json";

const validators = new Map<string, z.ZodType>();
const responses: Record<string, object> = contract.responses;

export function validateResponse(operation: string, data: unknown): unknown {
  let schema = validators.get(operation);
  if (!schema) {
    const definition = responses[operation];
    if (!definition) throw new Error(`Falta contrato de respuesta: ${operation}`);
    schema = z.fromJSONSchema({ ...definition, $defs: contract.definitions } as Parameters<
      typeof z.fromJSONSchema
    >[0]);
    validators.set(operation, schema);
  }
  return schema.parse(data);
}
