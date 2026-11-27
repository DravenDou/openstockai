"use client";

import { useState } from "react";
import { ArrowRight, RefreshCw, ShieldCheck } from "lucide-react";
import {
  traceDetailSchema,
  traceListSchema,
  type TraceDetail,
} from "@openstockai/api-client/agent-traces";
import { useInventory } from "@/shared/state/store";
import { PageHeading, EmptyState } from "@/shared/components/shared";
import { QueryState } from "@/shared/components/query-state";
import { Button } from "@/shared/ui/button";
import { Badge } from "@/shared/ui/badge";
import { cn } from "@/shared/lib/utils";
import { useRunQuery as useTraceQuery } from "../lib/use-run-query";

const number = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });
const duration = (ms: number) =>
  ms >= 1000 ? `${number.format(ms / 1000)} s` : `${number.format(ms)} ms`;

export function AgentRunsView() {
  return <TraceBrowser />;
}

function TraceBrowser() {
  const { settings } = useInventory();
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState("");
  const [refresh, setRefresh] = useState(0);
  const list = useTraceQuery({ offset }, traceListSchema, refresh);
  const traceId = selected || list.data?.items[0]?.traceId || "";
  const detail = useTraceQuery({ traceId }, traceDetailSchema, refresh, !!traceId);
  const busy = list.loading || detail.loading;
  const date = (value: string) =>
    new Date(value).toLocaleString("en-US", { timeZone: settings.timezone });
  function page(next: number) {
    setOffset(next);
    setSelected("");
  }
  return (
    <>
      <PageHeading
        title="Agent runs"
        description="Every turn your assistant ran: steps, tool calls, tokens and timing."
      >
        <Button variant="outline" disabled={busy} onClick={() => setRefresh((value) => value + 1)}>
          <RefreshCw size={16} className={list.loading ? "animate-spin" : ""} /> Refresh
        </Button>
      </PageHeading>
      <p className="flex items-start gap-2 text-sm text-muted-foreground">
        <ShieldCheck size={17} className="mt-0.5 shrink-0" />
        Timings, tools and reported usage are shown. Conversation and inventory content stays
        hidden.
      </p>
      <section aria-label="Recent runs" className="overflow-hidden rounded-xl border">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b p-5">
          <h2 className="font-semibold">Ejecuciones recientes</h2>
          {list.data && (
            <span className="text-sm text-muted-foreground">
              {number.format(list.data.total)} runs available
            </span>
          )}
        </div>
        <div className="px-5">
          <QueryState loading={list.loading} error={list.error} />
        </div>
        {list.data?.items.length === 0 && (
          <EmptyState
            title="No runs recorded"
            description="Runs appear after you use the assistant. Refresh to look for new runs."
          />
        )}
        {!!list.data?.items.length && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[660px] text-left text-sm">
              <caption className="sr-only">Select a run to see its steps.</caption>
              <thead className="border-b bg-muted/50 text-xs text-muted-foreground">
                <tr>
                  <th className="px-5 py-3 font-medium">Date</th>
                  <th className="px-5 py-3 font-medium">Conversation / trace</th>
                  <th className="px-5 py-3 font-medium">Duration</th>
                  <th className="px-5 py-3 font-medium">Steps</th>
                  <th className="px-5 py-3">
                    <span className="sr-only">Details</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {list.data.items.map((trace) => (
                  <tr
                    key={trace.traceId}
                    className={cn(
                      "transition-colors hover:bg-muted/50",
                      traceId === trace.traceId && "bg-secondary/60",
                    )}
                  >
                    <td className="whitespace-nowrap px-5 py-4">
                      <time dateTime={trace.startedAt}>{date(trace.startedAt)}</time>
                      <span className="mt-1 block text-xs text-muted-foreground">
                        {trace.agentName || "Agent"}
                      </span>
                    </td>
                    <td className="px-5 py-4">
                      <span
                        className="block max-w-64 truncate font-mono text-xs"
                        title={trace.conversationId || trace.traceId}
                      >
                        {trace.conversationId || "No conversation ID"}
                      </span>
                      <span className="mt-1 block font-mono text-xs text-muted-foreground">
                        {trace.traceId.slice(0, 12)}…
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-5 py-4 tabular-nums">
                      {duration(trace.durationMs)}
                    </td>
                    <td className="px-5 py-4 tabular-nums">{trace.spanCount}</td>
                    <td className="px-5 py-4">
                      <Button
                        variant={traceId === trace.traceId ? "secondary" : "ghost"}
                        size="sm"
                        aria-pressed={traceId === trace.traceId}
                        aria-label={`View run ${trace.traceId}`}
                        onClick={() => setSelected(trace.traceId)}
                      >
                        Ver <ArrowRight size={14} />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {list.data && list.data.total > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t px-5 py-4">
            <p className="text-xs text-muted-foreground">
              {offset + 1}–{offset + list.data.items.length} de {list.data.total}
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={offset === 0 || busy}
                onClick={() => page(Math.max(0, offset - 20))}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={list.data.nextOffset === null || busy}
                onClick={() => page(list.data!.nextOffset!)}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </section>
      {traceId && (
        <section aria-label="Run details" className="min-w-0 rounded-xl border p-5">
          <h2 className="mb-4 font-semibold">Run details</h2>
          <QueryState loading={detail.loading} error={detail.error} />
          {detail.data && <TraceSteps trace={detail.data} />}
        </section>
      )}
      <p className="text-xs leading-relaxed text-muted-foreground">
        Runs can update while the agent works and expire according to local retention. Token counts
        are informational.
      </p>
    </>
  );
}

function TraceSteps({ trace }: { trace: TraceDetail }) {
  const byId = new Map(trace.spans.map((span) => [span.spanId, span]));
  const models = [...new Set(trace.spans.flatMap((span) => (span.model ? [span.model] : [])))];
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <Badge variant={trace.errorSpanCount ? "destructive" : "outline"}>
          {trace.errorSpanCount
            ? `${trace.errorSpanCount} steps with errors`
            : "No errors recorded"}
        </Badge>
        <span className="text-sm tabular-nums">{duration(trace.durationMs)}</span>
        <span className="text-sm text-muted-foreground">
          Input:{" "}
          <span className="text-foreground tabular-nums">
            {trace.inputTokens === null ? "Not reported" : number.format(trace.inputTokens)}
          </span>
        </span>
        <span className="text-sm text-muted-foreground">
          Output:{" "}
          <span className="text-foreground tabular-nums">
            {trace.outputTokens === null ? "Not reported" : number.format(trace.outputTokens)}
          </span>
        </span>
      </div>
      {models.length > 0 && (
        <p className="break-words text-sm">
          <span className="text-muted-foreground">Model: </span>
          {models.join(", ")}
        </p>
      )}
      <dl className="grid gap-3 text-xs sm:grid-cols-2">
        <div>
          <dt className="text-muted-foreground">Trace ID</dt>
          <dd className="mt-1 break-all font-mono">{trace.traceId}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Conversation</dt>
          <dd className="mt-1 break-all font-mono">{trace.conversationId || "Not reported"}</dd>
        </div>
      </dl>
      {trace.truncated && (
        <p role="status" className="text-sm text-muted-foreground">
          The first 2,000 steps are shown. Totals cover the whole trace.
        </p>
      )}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-left text-sm">
          <caption className="sr-only">Run steps in time order. Indentation shows nesting.</caption>
          <thead className="border-y text-xs text-muted-foreground">
            <tr>
              <th className="py-3 pr-4 font-medium">Operation</th>
              <th className="px-4 py-3 font-medium">Inicio relativo</th>
              <th className="px-4 py-3 font-medium">Duration</th>
              <th className="py-3 pl-4 font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {trace.spans.map((span) => {
              const visited = new Set([span.spanId]);
              let parent = span.parentSpanId;
              while (parent && byId.has(parent) && !visited.has(parent) && visited.size < 9) {
                visited.add(parent);
                parent = byId.get(parent)!.parentSpanId;
              }
              return (
                <tr key={span.spanId}>
                  <td className="py-3 pr-4" style={{ paddingLeft: (visited.size - 1) * 16 }}>
                    <span className="block font-medium">{span.name}</span>
                    {(span.tool || span.model) && (
                      <span className="mt-1 block max-w-80 break-words text-xs text-muted-foreground">
                        {span.tool || span.model}
                      </span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-xs tabular-nums">
                    +{duration(span.offsetMs)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-xs tabular-nums">
                    {duration(span.durationMs)}
                  </td>
                  <td className="py-3 pl-4 text-xs">
                    <span
                      className={
                        span.statusCode === 2 ? "text-destructive" : "text-muted-foreground"
                      }
                    >
                      {span.statusCode === 2 ? "Error" : "Recorded"}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
