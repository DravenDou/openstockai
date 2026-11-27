"use client";

// Adapted from Vercel AI Elements (MIT); see LICENSE and README in this folder.
import { cn } from "@/shared/lib/utils";
import type { ComponentProps, HTMLAttributes } from "react";
import { memo } from "react";
import { Streamdown } from "streamdown";

export function Message({
  className,
  from,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  from: "user" | "assistant";
}) {
  return (
    <div
      className={cn(
        "group flex w-full min-w-0 flex-col gap-2",
        from === "user" ? "is-user ml-auto items-end" : "is-assistant",
        className,
      )}
      {...props}
    />
  );
}

export function MessageContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex min-w-0 max-w-full flex-col gap-3 text-sm leading-relaxed",
        "group-[.is-user]:max-w-[628px] group-[.is-user]:rounded-[14px_14px_3px_14px] group-[.is-user]:bg-muted group-[.is-user]:px-5 group-[.is-user]:py-4",
        className,
      )}
      {...props}
    />
  );
}

// Same-origin links (such as the CSV export the agent returns) open directly; every other
// link still goes through Streamdown's link-safety confirmation.
function isSameOrigin(url: string) {
  try {
    return new URL(url, window.location.origin).origin === window.location.origin;
  } catch {
    return false;
  }
}

// Optional code/math/diagram plugins are unnecessary for inventory replies.
export const MessageResponse = memo(function MessageResponse({
  className,
  ...props
}: ComponentProps<typeof Streamdown>) {
  return (
    <Streamdown
      skipHtml
      linkSafety={{ enabled: true, onLinkCheck: isSameOrigin }}
      components={{
        img: () => null,
        strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
      }}
      className={cn("min-w-0 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0", className)}
      {...props}
    />
  );
});
