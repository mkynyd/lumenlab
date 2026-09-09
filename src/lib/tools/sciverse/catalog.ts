/**
 * Sciverse internal capability: /meta-catalog.
 *
 * Not registered as an Agent tool. Exists so platform code (and future
 * iterations) can learn the field catalog for a collection without
 * hardcoding field names.
 */

import { requestSciverse } from "./transport";
import type { SciverseCatalog, SciverseCatalogField } from "./types";

export type SciverseCatalogCollection = "papers" | "authors" | "sources";

export interface SciverseCatalogOptions {
  token: string;
  collection?: SciverseCatalogCollection;
  includeSampleValues?: boolean;
  includeFieldStats?: boolean;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}

function parseCatalog(payload: unknown): SciverseCatalog {
  const record = payload && typeof payload === "object" && !Array.isArray(payload)
    ? (payload as Record<string, unknown>)
    : {};
  const fields: SciverseCatalogField[] = [];
  for (const raw of Array.isArray(record.fields) ? record.fields : []) {
    if (!raw || typeof raw !== "object") continue;
    const field = raw as Record<string, unknown>;
    if (typeof field.name !== "string" || !field.name) continue;
    fields.push({
      name: field.name,
      type: typeof field.type === "string" ? field.type : "String",
      filterable: field.filterable === true,
      sortable: field.sortable === true,
      searchable: field.searchable === true,
      default_returned: field.default_returned === true,
      ...(typeof field.description === "string" ? { description: field.description } : {}),
      ...(Array.isArray(field.sample_values)
        ? { sample_values: field.sample_values.filter((v): v is string | number | boolean =>
            typeof v === "string" || typeof v === "number" || typeof v === "boolean") }
        : {}),
      ...(Array.isArray(field.operators) ? { operators: field.operators as Array<string | { name?: string }> } : {}),
    });
  }
  return {
    fields,
    default_fields: Array.isArray(record.default_fields)
      ? record.default_fields.filter((v): v is string => typeof v === "string")
      : [],
    filter_operators: Array.isArray(record.filter_operators)
      ? (record.filter_operators as Array<string | { name?: string }>)
      : [],
  };
}

export async function listCatalog(options: SciverseCatalogOptions): Promise<SciverseCatalog> {
  const query: Record<string, string | number | boolean> = {
    collection: options.collection ?? "papers",
  };
  if (options.includeSampleValues) query.include_sample_values = true;
  if (options.includeFieldStats) query.include_field_stats = true;
  const payload = await requestSciverse<unknown>({
    method: "GET",
    path: "/meta-catalog",
    query,
    token: options.token,
    baseUrl: options.baseUrl,
    fetchImpl: options.fetchImpl,
    signal: options.signal,
  });
  return parseCatalog(payload);
}
