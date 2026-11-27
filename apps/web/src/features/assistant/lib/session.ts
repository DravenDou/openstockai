import { z } from "zod";
import type { SessionStreamEvent } from "eve/client";

export function chatError(events: readonly SessionStreamEvent[]) {
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index];
    if (event.type === "turn.settled" && event.data.outcome === "failed")
      return event.data.error?.message;
    if (event.type === "session.ended" && event.data.outcome === "failed")
      return event.data.error?.message;
    // A later turn, or any other end of a turn, clears an earlier failure.
    if (
      event.type === "turn.started" ||
      event.type === "turn.settled" ||
      event.type === "session.started"
    )
      return undefined;
  }
}

const cursor = z.object({
  sessionId: z.string().regex(/^[-\w]{1,200}$/),
  streamIndex: z.number().int().nonnegative(),
});
export function savedChatSession(raw: string | null) {
  try {
    const parsed = cursor.safeParse(JSON.parse(raw || "null"));
    // Replay the durable stream; the browser stores neither messages nor approvals.
    return parsed.success ? { sessionId: parsed.data.sessionId, streamIndex: 0 } : undefined;
  } catch {
    return undefined;
  }
}
export function chatSessionKey(user: string, authSession: string) {
  return `openstockai-chat:${JSON.stringify([user, authSession])}`;
}
