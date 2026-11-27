"use client";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Switch } from "@/shared/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/ui/tabs";
import { type Settings } from "@/shared/state/inventory";
import { inventoryActions, useInventory } from "@/shared/state/store";
import { Check, Sparkles } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { ActionLink, Choice, PageHeading, PanelTitle } from "../../../shared/components/shared";

export function SettingsView() {
  const { settings } = useInventory();
  return <SettingsForm key={JSON.stringify(settings)} initial={settings} />;
}
// The full IANA list from the runtime; UTC is the default and is always offered.
const timezones = ["UTC", ...Intl.supportedValuesOf("timeZone").filter((zone) => zone !== "UTC")];
function SettingsForm({ initial }: { initial: Settings }) {
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState(initial);
  const [tab, setTab] = useState("general");
  const update = <K extends keyof Settings>(key: K, value: Settings[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));
  const aiSettings: {
    key: "automatic" | "confirm" | "lowStock" | "voice";
    title: string;
    description: string;
  }[] = [
    {
      key: "automatic",
      title: "Auto-approve low-risk actions",
      description:
        "The assistant applies low-risk changes without asking. Deletes and archives always need your confirmation.",
    },
    {
      key: "confirm",
      title: "Confirm incomplete data",
      description: "Asks before changing quantities or costs.",
    },
    {
      key: "lowStock",
      title: "Low stock alerts",
      description: "Detects products at or below minimum stock.",
    },
    {
      key: "voice",
      title: "Voice replies",
      description: "Listen to the assistant's replies.",
    },
  ];
  const assistantPanel = (
    <section className="soft-panel space-y-6 p-6">
      <h2 className="flex items-center gap-2.5 text-base font-semibold">
        <Sparkles size={19} className="text-primary" />
        How OpenStock AI works
      </h2>
      <div className="space-y-6">
        {aiSettings.map((item) => (
          <div className="flex items-start justify-between gap-5" key={item.key}>
            <div>
              <label htmlFor={`setting-${item.key}`} className="text-xs font-medium">
                {item.title}
              </label>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                {item.key === "confirm"
                  ? "If data is missing, OpenStock AI always asks before applying changes."
                  : item.description}
              </p>
            </div>
            <Switch
              id={`setting-${item.key}`}
              checked={item.key === "confirm" ? true : draft[item.key]}
              disabled={item.key === "confirm"}
              onCheckedChange={(value) => update(item.key, value)}
              className="mt-1 shrink-0"
            />
          </div>
        ))}
      </div>
      <p className="flex gap-2 border-t pt-5 text-[11px] leading-relaxed text-muted-foreground">
        <ShieldIcon />
        AI changes are kept in the history and can be undone.
      </p>
      <p className="text-[10px] leading-relaxed text-muted-foreground">
        Sensitive operations always require approval.
      </p>
    </section>
  );
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (busy) return;
        setBusy(true);
        try {
          await inventoryActions.settings(draft);
          toast.success("Changes saved");
        } catch (error) {
          toast.error((error as Error).message);
        } finally {
          setBusy(false);
        }
      }}
      className="space-y-7"
    >
      <PageHeading
        title="Your store, your way."
        description="Configure your workspace and how the assistant behaves."
      >
        <Button type="submit" disabled={busy} className="h-10 text-xs">
          <Check size={14} />
          Save changes
        </Button>
      </PageHeading>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="mb-7 h-auto max-w-full justify-start gap-6 overflow-x-auto rounded-none border-b bg-transparent p-0 pb-3">
          {[
            { value: "general", label: "General" },
            { value: "ai", label: "AI assistant" },
            { value: "notifications", label: "Notifications" },
          ].map((item) => (
            <TabsTrigger
              key={item.value}
              value={item.value}
              className="shrink-0 rounded-none px-0 text-xs shadow-none!"
            >
              {item.label}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="general">
          <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(320px,1fr)]">
            <section className="space-y-6 rounded-xl border p-6">
              <PanelTitle>Store details</PanelTitle>
              <label className="block">
                <span className="field-label">Store name</span>
                <Input
                  aria-label="Store name"
                  value={draft.store}
                  onChange={(e) => update("store", e.target.value)}
                  required
                  className="h-11 text-[13px] shadow-none"
                />
              </label>
              <label className="block">
                <span className="field-label">Email</span>
                <Input
                  aria-label="Email"
                  type="email"
                  value={draft.email}
                  onChange={(e) => update("email", e.target.value)}
                  required
                  className="h-11 text-[13px] shadow-none"
                />
              </label>
              <div>
                <label className="field-label">Currency</label>
                <Choice
                  value={draft.currency}
                  onChange={(v) => update("currency", v as Settings["currency"])}
                  options={["USD", "EUR", "GBP", "BOB"]}
                  label="Currency"
                />
              </div>
              <div>
                <label className="field-label" htmlFor="timezone">
                  Time zone
                </label>
                <select
                  id="timezone"
                  className="mt-2 h-11 w-full rounded-md border bg-background px-3 text-[13px]"
                  value={draft.timezone}
                  onChange={(e) => update("timezone", e.target.value)}
                >
                  {timezones.map((zone) => (
                    <option key={zone} value={zone}>
                      {zone}
                    </option>
                  ))}
                </select>
              </div>
            </section>
            <div>
              {assistantPanel}
              <ActionLink href="/warehouses" className="mt-6">
                Manage warehouses
              </ActionLink>
            </div>
          </div>
        </TabsContent>
        <TabsContent value="ai">
          <div className="max-w-2xl">{assistantPanel}</div>
        </TabsContent>
        <TabsContent value="notifications">
          <section className="max-w-2xl space-y-6 rounded-xl border p-6">
            <PanelTitle>Inventory notifications</PanelTitle>
            <div className="flex justify-between gap-5">
              <div>
                <label htmlFor="notify-low" className="text-sm">
                  Low stock alerts
                </label>
                <p className="mt-2 text-xs text-muted-foreground">
                  Shows products that need restocking.
                </p>
              </div>
              <Switch
                id="notify-low"
                checked={draft.lowStock}
                onCheckedChange={(v) => update("lowStock", v)}
              />
            </div>
            <p className="border-t pt-5 text-xs text-muted-foreground">
              Email notifications require connecting an email delivery service.
            </p>
          </section>
        </TabsContent>
      </Tabs>
    </form>
  );
}
function ShieldIcon() {
  return <Check size={14} className="mt-0.5 shrink-0" />;
}
