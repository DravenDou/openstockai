"use client";
import { useState } from "react";
import { useAPI } from "@/shared/api/use-api";
import { actorLabel } from "@/shared/state/inventory";
import { useInventory } from "@/shared/state/store";
import type { Schemas } from "@openstockai/api-client/client";
import { QueryState } from "../../../shared/components/query-state";
import { EmptyState, PageHeading, SearchInput } from "../../../shared/components/shared";
import { HistoryNavigation } from "@/shared/components/history-navigation";

export function AuditView() {
  const { settings, identity } = useInventory();
  const [search, setSearch] = useState("");
  const [actor, setActor] = useState("");
  const [cursors, setCursors] = useState<Schemas["HistoryCursor"][]>([]);
  const cursor = cursors.at(-1);
  const result = useAPI(
    "/v1/audit-page",
    {
      query: search,
      actor,
      limit: 20,
      ...(cursor ? { beforeId: cursor.id, beforeDate: cursor.date } : {}),
    },
    undefined,
  );
  return (
    <>
      <PageHeading
        title="Audit log"
        description="Immutable record of changes made by you and the assistant."
      />
      <section className="rounded-xl border p-5">
        <div className="mb-5 flex flex-wrap gap-3">
          <SearchInput
            value={search}
            onChange={(value) => {
              setSearch(value);
              setCursors([]);
            }}
            placeholder="Search operation or resource"
          />
          <select
            aria-label="Audit source"
            className="h-10 rounded border bg-background px-3 text-sm"
            value={actor}
            onChange={(e) => {
              setActor(e.target.value);
              setCursors([]);
            }}
          >
            <option value="">All sources</option>
            <option value="human">Users</option>
            <option value="ai">Assistant</option>
            <option value="system">System</option>
          </select>
        </div>
        <QueryState loading={result.loading} error={result.error} />
        {result.data?.items.length === 0 && <EmptyState title="No changes recorded" />}
        <div className="divide-y">
          {result.data?.items.map((entry) => (
            <details key={entry.id} className="py-4">
              <summary className="cursor-pointer text-sm">
                <span className="font-medium">{entry.action}</span>
                <span className="mt-2 block text-xs text-muted-foreground">
                  {actorLabel(entry.actor_type, identity)} ·{" "}
                  {new Date(entry.created_at).toLocaleString("en-US", {
                    timeZone: settings.timezone,
                  })}
                </span>
              </summary>
              <p className="mt-4 break-all text-xs text-muted-foreground">
                {entry.resource_type} · {entry.resource_id}
              </p>
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                {[
                  ["Before", entry.before],
                  ["After", entry.after],
                ].map(([label, value]) => (
                  <div key={String(label)}>
                    <p className="mb-2 text-xs font-medium">{String(label)}</p>
                    <pre className="max-h-80 overflow-auto rounded bg-muted p-3 text-xs">
                      {JSON.stringify(value, null, 2)}
                    </pre>
                  </div>
                ))}
              </div>
            </details>
          ))}
        </div>
        <HistoryNavigation
          back={cursors.length > 0 && !result.loading}
          next={!!result.data?.next && !result.loading}
          onBack={() => setCursors((c) => c.slice(0, -1))}
          onNext={() => {
            if (result.data?.next) setCursors((c) => [...c, result.data!.next!]);
          }}
        />
      </section>
    </>
  );
}
