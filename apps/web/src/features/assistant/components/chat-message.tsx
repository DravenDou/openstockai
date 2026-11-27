"use client";

import type { EveMessage } from "eve/client";
import { AudioLines, Brain, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { Message, MessageContent, MessageResponse } from "@/shared/components/ai-elements/message";
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
} from "@/shared/components/ai-elements/tool";
import { toolLabels, toolPresentation } from "../lib/chat";

export function AssistantAvatar() {
  return (
    <span
      className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-white"
      aria-hidden="true"
    >
      <AudioLines size={17} />
    </span>
  );
}

export function ChatMessage({
  message,
  failure,
  sessionId,
}: {
  message: EveMessage;
  failure?: { code: string; message: string };
  sessionId?: string;
}) {
  if (
    !failure &&
    !message.parts.some(
      (p) =>
        (p.type === "tool" && !p.hidden) ||
        ((p.type === "text" || p.type === "reasoning") && p.text),
    )
  )
    return null;
  const assistant = message.role === "assistant";
  return (
    <Message from={message.role}>
      <div className={assistant ? "flex min-w-0 gap-3" : "flex justify-end"}>
        {assistant && <AssistantAvatar />}
        <MessageContent className={assistant ? "min-w-0 flex-1 pt-1" : ""}>
          {message.parts.map((part, index) => {
            if (part.type === "text" && part.text) {
              return assistant ? (
                <MessageResponse key={part.id || index} isAnimating={part.state === "streaming"}>
                  {part.text}
                </MessageResponse>
              ) : (
                <p key={part.id || index} className="whitespace-pre-wrap break-words">
                  {part.text}
                </p>
              );
            }
            if (part.type === "reasoning" && part.text)
              return (
                <details
                  key={part.id || index}
                  className="rounded-lg border p-3 text-xs text-muted-foreground"
                >
                  <summary className="flex cursor-pointer items-center gap-2">
                    <Brain size={14} />
                    {part.state === "streaming" ? "Analyzing…" : "Model analysis"}
                  </summary>
                  <MessageResponse className="mt-3" isAnimating={part.state === "streaming"}>
                    {part.text}
                  </MessageResponse>
                </details>
              );
            if (part.type !== "tool" || part.hidden) return null;
            const presentation = toolPresentation(part);
            return (
              <Tool key={part.callId} defaultOpen={presentation.state === "output-error"}>
                <ToolHeader
                  type="dynamic-tool"
                  toolName={part.name}
                  title={toolLabels[part.name] || part.name}
                  state={presentation.state}
                />
                <ToolContent>
                  <p className="break-all font-mono text-[11px] text-muted-foreground">
                    {part.name} · {part.callId}
                  </p>
                  <ToolInput
                    input={part.input ?? (part.state === "streaming" ? part.inputText : undefined)}
                  />
                  <ToolOutput output={part.output} errorText={presentation.errorText} />
                </ToolContent>
              </Tool>
            );
          })}
          {failure && assistant && (
            <div
              role="alert"
              className="space-y-2 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm"
            >
              <p className="flex items-center gap-2 font-medium">
                <TriangleAlert size={16} />
                The response could not be completed
              </p>
              <p>{failure.message}</p>
              <p className="text-xs text-muted-foreground">
                Review the actions before repeating a write.
              </p>
            </div>
          )}
          {assistant && sessionId && (
            <details className="text-[11px] text-muted-foreground">
              <summary className="cursor-pointer">Response trace</summary>
              <p className="mt-2 break-all font-mono">
                Conversation: {sessionId}
                <br />
                Turn: {message.metadata?.turnId || "—"}
                {failure && (
                  <>
                    <br />
                    Status: {failure.code}
                  </>
                )}
              </p>
              <Link href="/agent-runs" className="mt-2 inline-block underline">
                View agent runs
              </Link>
            </details>
          )}
        </MessageContent>
      </div>
    </Message>
  );
}
