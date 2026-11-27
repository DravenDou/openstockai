"use client";
import { useState } from "react";
import { useAPI } from "@/shared/api/use-api";
import { Input } from "../ui/input";
import { QueryState } from "./query-state";

type Endpoint = "/v1/categories" | "/v1/warehouses" | "/v1/suppliers";
const details = {
  "/v1/categories": "/v1/categories/{id}",
  "/v1/warehouses": "/v1/warehouses/{id}",
  "/v1/suppliers": "/v1/suppliers/{id}",
} as const;
export function LookupSelect({
  endpoint,
  label,
  value,
  onChange,
  name,
  required = false,
  emptyLabel = "Select",
  disabled = false,
}: {
  endpoint: Endpoint;
  label: string;
  value: string;
  onChange: (value: string) => void;
  name?: string;
  required?: boolean;
  emptyLabel?: string;
  disabled?: boolean;
}) {
  const [search, setSearch] = useState("");
  const result = useAPI(endpoint, { query: search, limit: 50 });
  const selected = useAPI(details[endpoint], {}, value, !!value);
  return (
    <div className="space-y-2">
      <label className="block text-xs">
        {label}
        <select
          aria-label={label}
          name={name}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          required={required}
          disabled={disabled}
          className="mt-2 h-10 w-full rounded-lg border bg-background px-3 text-sm"
        >
          <option value="">{emptyLabel}</option>
          {value && !result.data?.some((row) => row.id === value) && (
            <option value={value}>
              {selected.data?.name ||
                (selected.loading ? "Loading selection…" : "Selection unavailable")}
            </option>
          )}
          {result.data?.map((row) => (
            <option key={row.id} value={row.id}>
              {row.name}
            </option>
          ))}
        </select>
      </label>
      <Input
        type="search"
        aria-label={`Search ${label.toLowerCase()}`}
        placeholder={`Search ${label.toLowerCase()}…`}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        disabled={disabled}
        className="h-8 text-xs"
      />
      <QueryState loading={result.loading} error={result.error || selected.error} />
    </div>
  );
}
