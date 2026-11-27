"use client";

// Adapted from Vercel AI Elements (Apache License 2.0, Copyright 2023 Vercel, Inc.) and modified
// for OpenStock AI; see LICENSE, LICENSE-2.0.txt and README in this folder.
import { Button } from "@/shared/ui/button";
import { cn } from "@/shared/lib/utils";
import { ArrowDownIcon } from "lucide-react";
import type { ComponentProps } from "react";
import { StickToBottom, useStickToBottomContext } from "use-stick-to-bottom";

export function Conversation({ className, ...props }: ComponentProps<typeof StickToBottom>) {
  return (
    <StickToBottom
      className={cn("relative min-h-0 flex-1 overflow-y-hidden", className)}
      initial="smooth"
      resize="smooth"
      role="log"
      {...props}
    />
  );
}

export function ConversationContent({
  className,
  ...props
}: ComponentProps<typeof StickToBottom.Content>) {
  return (
    <StickToBottom.Content className={cn("flex min-w-0 flex-col gap-7", className)} {...props} />
  );
}

export function ConversationScrollButton() {
  const { isAtBottom, scrollToBottom } = useStickToBottomContext();
  return (
    !isAtBottom && (
      <Button
        aria-label="Go to latest message"
        className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full"
        onClick={() => void scrollToBottom()}
        size="icon"
        type="button"
        variant="outline"
      >
        <ArrowDownIcon className="size-4" />
      </Button>
    )
  );
}
