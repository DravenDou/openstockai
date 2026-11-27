"use client";
import { Button } from "@/shared/ui/button";
import { TooltipProvider } from "@/shared/ui/tooltip";
import { euro, movementDate } from "@/shared/state/inventory";
import { refreshInventory, useInventory } from "@/shared/state/store";
import { useEveAgent } from "eve/react";
import type { ClientSessionState } from "eve/client";
import { authClient } from "@/shared/auth/client";
import {
  Conversation as ChatConversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/shared/components/ai-elements/conversation";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Mic,
  Plus,
  Send,
  Sparkles,
  Square,
  TriangleAlert,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { ApprovalCard } from "../components/approval-card";
import { ChatMessage, AssistantAvatar } from "../components/chat-message";
import { turnFailures } from "../lib/chat";
import { chatError, chatSessionKey, savedChatSession } from "../lib/session";
import { ActionLink, ProductIcon } from "../../../shared/components/shared";

type Recognition = {
  lang: string;
  interimResults: boolean;
  onresult:
    | ((event: { results: { [key: number]: { [key: number]: { transcript: string } } } }) => void)
    | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

export function ChatView() {
  const { data } = authClient.useSession();
  const scope = chatSessionKey(data?.user.id || "", data?.session.id || "");
  const ready = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  if (!ready) return <p role="status">Preparing conversation…</p>;
  return <Conversation key={scope} scope={scope} />;
}
function Conversation({ scope }: { scope: string }) {
  const [initialSession] = useState<ClientSessionState | undefined>(() => {
    try {
      return savedChatSession(sessionStorage.getItem(scope));
    } catch {
      return undefined;
    }
  });
  const { products, movements, settings, summary } = useInventory();
  const [text, setText] = useState("");
  const [recording, setRecording] = useState(false);
  const [sendError, setSendError] = useState("");
  const recognition = useRef<Recognition | null>(null);
  const sending = useRef(false);
  const agent = useEveAgent({
    initialSession,
    resume: !!initialSession,
    onSessionChange: (session) => {
      try {
        if (session) sessionStorage.setItem(scope, JSON.stringify(session));
        else sessionStorage.removeItem(scope);
      } catch {
        /* A storage failure must not interrupt the durable turn. */
      }
    },
    onFinish: (snapshot) => {
      void refreshInventory().catch((e) => toast.error((e as Error).message));
      if (settings.voice && "speechSynthesis" in window) {
        const last = snapshot.data.messages.filter((m) => m.role === "assistant").at(-1);
        const text = last?.parts.map((p) => (p.type === "text" ? p.text : "")).join("");
        if (text) {
          const speech = new SpeechSynthesisUtterance(text);
          speech.lang = "en-US";
          window.speechSynthesis.cancel();
          window.speechSynthesis.speak(speech);
        }
      }
    },
    onError: (error) => setSendError(error.message),
  });
  useEffect(
    () => () => {
      recognition.current?.stop();
      if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    },
    [],
  );
  const thinking =
    agent.status === "submitted" || agent.status === "streaming" || agent.status === "resuming";
  const pending = Object.values(agent.data.inputs).filter((input) => input.status === "open");
  const failures = turnFailures(agent.events);
  const error = agent.error?.message || chatError(agent.events);
  async function send(message = text) {
    if (!message.trim() || thinking || pending.length || sending.current) return;
    sending.current = true;
    setSendError("");
    try {
      setText("");
      await agent.send(message.trim());
    } catch (error) {
      setSendError((error as Error).message);
    } finally {
      sending.current = false;
    }
  }
  function toggleVoice() {
    if (recording) {
      recognition.current?.stop();
      setRecording(false);
      return;
    }
    const browser = window as unknown as {
      SpeechRecognition?: new () => Recognition;
      webkitSpeechRecognition?: new () => Recognition;
    };
    const SpeechRecognition = browser.SpeechRecognition || browser.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      toast.info(
        "Voice transcription is not available in this browser. You can type your message.",
      );
      return;
    }
    const instance = new SpeechRecognition();
    instance.lang = "en-US";
    instance.interimResults = false;
    instance.onresult = (event) => {
      setText(event.results[0][0].transcript);
      setRecording(false);
    };
    instance.onerror = () => {
      setRecording(false);
      toast.error("Could not hear you. Check microphone permission and try again.");
    };
    instance.onend = () => setRecording(false);
    recognition.current = instance;
    try {
      instance.start();
      setRecording(true);
    } catch {
      toast.error("Could not start the microphone.");
    }
  }
  return (
    <TooltipProvider delayDuration={200}>
      <div className="grid gap-8 lg:min-h-[calc(100svh-164px)] xl:grid-cols-[minmax(0,1fr)_300px] xl:gap-8">
        <section className="flex h-[calc(100svh-164px)] min-h-[620px] min-w-0 flex-col lg:min-h-0">
          <div>
            <h1 className="text-[30px] leading-tight font-semibold tracking-[-.027em]">
              Your stock, one conversation away.
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              You talk. OpenStock AI records. Your store keeps running.
            </p>
          </div>
          <ChatConversation className="mt-7" aria-label="Conversation with OpenStock AI">
            <ConversationContent className="pr-2 pb-3">
              {agent.data.messages.length === 0 && (
                <div className="flex gap-4 py-8">
                  <AssistantAvatar />
                  <p className="text-sm leading-relaxed">
                    Check your stock, record a delivery or create a product. OpenStock AI will
                    verify the data in your inventory.
                  </p>
                </div>
              )}
              {agent.data.messages.map((message) => (
                <ChatMessage
                  key={message.id}
                  message={message}
                  failure={
                    message.role === "assistant"
                      ? failures.get(message.metadata?.turnId || "")
                      : undefined
                  }
                  sessionId={agent.session?.sessionId}
                />
              ))}
              {pending.map((input) => (
                <ApprovalCard
                  key={input.request.requestId}
                  input={input}
                  disabled={agent.status === "resuming"}
                  onRespond={(requestId, optionId) => agent.respond([{ requestId, optionId }])}
                />
              ))}
              {(sendError || error) && (
                <p role="alert" className="text-sm text-destructive">
                  {sendError || error}
                </p>
              )}
              {thinking && !pending.length && (
                <div
                  role="status"
                  className="flex items-center gap-3 text-xs text-muted-foreground"
                >
                  <AssistantAvatar />
                  <span className="animate-pulse">
                    {agent.status === "resuming"
                      ? "Restoring conversation…"
                      : agent.status === "submitted"
                        ? "Connecting to OpenStock AI…"
                        : "OpenStock AI is working on your request…"}
                  </span>
                </div>
              )}
            </ConversationContent>
            <ConversationScrollButton />
          </ChatConversation>
          <div className="mt-8 space-y-4">
            <div className="flex shrink-0 gap-2.5 overflow-x-auto pb-1 [&>button]:shrink-0">
              <Button
                variant="outline"
                className="h-9 rounded-lg text-xs font-normal text-muted-foreground shadow-none"
                onClick={() => void send("Which products should I restock?")}
                disabled={thinking || !!pending.length}
              >
                Which products should I restock?
              </Button>
              <Button
                variant="outline"
                className="h-9 rounded-lg text-xs font-normal text-muted-foreground shadow-none"
                onClick={() => void send("Show me today's sales")}
                disabled={thinking || !!pending.length}
              >
                Show me today&apos;s sales
              </Button>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void send();
              }}
              className="rounded-[14px] border border-[#dadada] p-[18px] focus-within:border-primary"
            >
              <textarea
                aria-label="Message to OpenStock AI"
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void send();
                  }
                }}
                placeholder="Ask a question or say what you want to change in the inventory…"
                rows={2}
                disabled={agent.status === "resuming" || !!pending.length}
                className="min-h-11 w-full resize-none bg-transparent text-sm leading-relaxed outline-none! placeholder:text-muted-foreground"
              />
              <div className="mt-3 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  {thinking && agent.status !== "resuming" && (
                    <Button
                      type="button"
                      variant="outline"
                      className="h-9 text-xs"
                      onClick={() =>
                        void agent.cancel().catch((e) => toast.error((e as Error).message))
                      }
                    >
                      <Square size={13} />
                      Cancel response
                    </Button>
                  )}
                  <ActionLink href="/purchases/new" variant="ghost" className="h-7 px-1">
                    <Plus size={16} />
                    <span className="sr-only">Record manual purchase</span>
                  </ActionLink>
                  <span className="hidden items-center gap-1.5 text-[11px] text-muted-foreground sm:flex">
                    <Sparkles size={12} />
                    {settings.automatic ? "Automatic updates" : "Review before applying"}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Button type="button" className="h-9 rounded-lg text-xs" onClick={toggleVoice}>
                    {recording ? <Square size={13} /> : <Mic size={13} />}{" "}
                    {recording ? "Stop" : "Talk to OpenStock AI"}
                  </Button>
                  <Button
                    type="submit"
                    size="icon"
                    className="size-9 rounded-full bg-foreground text-white hover:bg-foreground/80"
                    aria-label="Send message"
                    disabled={!text.trim() || thinking || !!pending.length}
                  >
                    <Send size={15} />
                  </Button>
                </div>
              </div>
            </form>
            <p className="text-center text-[11px] leading-relaxed text-muted-foreground">
              {pending.length
                ? "Review and approve or reject the pending action before continuing."
                : "Type freely. If information is missing, OpenStock AI will ask before changing the inventory."}
            </p>
            <Button
              type="button"
              variant="ghost"
              className="w-full text-xs"
              disabled={thinking || !!pending.length}
              onClick={() => {
                agent.reset();
                setSendError("");
              }}
            >
              New conversation
            </Button>
            <p className="text-center text-[10px] text-muted-foreground">
              Actions are recorded in the history.
            </p>
          </div>
        </section>
        <aside className="soft-panel flex min-w-0 flex-col gap-[26px] p-6 xl:max-h-[calc(100svh-164px)] xl:overflow-y-auto">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-[19px] font-semibold tracking-[-.02em]">Live inventory</h2>
            <span className="flex items-center gap-1.5 rounded-md bg-[#fff0e5] px-2 py-1 text-[10px] text-[#9b3c00]">
              <span className="size-1.5 rounded-full bg-primary" />
              Live
            </span>
          </div>
          <div className="grid grid-cols-2 gap-[22px] border-b pb-[22px]">
            <div>
              <p className="text-[11px] text-muted-foreground">Products</p>
              <p className="tabular mt-2 text-2xl font-semibold tracking-[-.02em]">
                {summary.products}
              </p>
            </div>
            <div>
              <p className="text-[11px] text-muted-foreground">Total value</p>
              <p className="tabular mt-2 whitespace-nowrap text-2xl font-semibold tracking-[-.02em]">
                {euro(summary.stock_value, false)}
              </p>
            </div>
          </div>
          <div className="space-y-[17px]">
            <div className="flex items-center justify-between text-[13px]">
              <h3 className="font-medium">Recent products</h3>
              <span className="text-[11px] text-muted-foreground">
                {Math.min(products.length, 2)} products
              </span>
            </div>
            {products.slice(0, 2).map((p) => (
              <Link
                href={`/inventory/${p.id}`}
                key={p.id}
                className="block space-y-4 rounded-[10px] border border-[#e7e7e7] bg-white p-[18px] transition-colors hover:border-[#c7c7c7]"
              >
                <div className="flex items-center gap-2 text-sm">
                  <ProductIcon icon={p.icon} className="size-5 bg-transparent [&_svg]:size-4" />
                  {p.name}
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-baseline gap-2">
                    <strong className="tabular text-[30px] leading-none font-semibold tracking-[-.03em]">
                      {p.stock}
                    </strong>
                    <span className="text-[11px] text-muted-foreground">in stock</span>
                  </div>
                  <span className="rounded-md bg-[#fff0e5] px-2 py-1 text-[11px] text-[#9b3c00]">
                    Current stock
                  </span>
                </div>
              </Link>
            ))}
          </div>
          {settings.lowStock && (
            <Link href="/restock" className="flex gap-3 border-y py-4">
              <TriangleAlert size={18} className="shrink-0 text-[#a5470b]" />
              <div>
                <p className="text-xs">{summary.low} products need restocking</p>
                <p className="mt-1.5 text-[11px] text-muted-foreground">
                  Ask OpenStock AI which ones.
                </p>
              </div>
            </Link>
          )}
          <div className="space-y-[18px]">
            <h3 className="text-[13px] font-semibold">Latest movements</h3>
            {movements.slice(0, 2).map((m) => (
              <div className="flex items-center gap-2.5" key={m.id}>
                <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-white text-muted-foreground">
                  {m.quantity > 0 ? <ArrowDownLeft size={14} /> : <ArrowUpRight size={14} />}
                </span>
                <div>
                  <p className="text-xs">
                    {m.kind}: {Math.abs(m.quantity)} {m.unitSymbol || "units"}
                  </p>
                  <p className="mt-1.5 text-[10px] text-muted-foreground">
                    {movementDate(m, settings.timezone)} · Recorded by{" "}
                    {m.actor === "OpenStock AI" ? "Assistant" : m.actor}
                  </p>
                </div>
              </div>
            ))}
          </div>
          <ActionLink href="/inventory" className="mt-auto w-full justify-between bg-white px-3.5">
            Open full inventory
            <ArrowUpRight size={16} />
          </ActionLink>
        </aside>
      </div>
    </TooltipProvider>
  );
}
