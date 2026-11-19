import { Calendar, CircleAlert, CircleCheck, FileText, Mail } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader } from "@/components/page-header";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { Toolkit } from "@/db/schema";
import { COMPANY_DOCUMENTS } from "@/lib/agent/company-context";
import { getConnections } from "@/lib/composio/connections";
import { requireUser } from "@/lib/session";
import { getSettings } from "@/lib/settings";
import { connectToolkit, disconnectToolkit } from "./actions";
import { SchedulingForm } from "./scheduling-form";

export const metadata: Metadata = { title: "Settings" };

const NOTICES: Record<string, { tone: "success" | "error"; text: string }> = {
  gmail: { tone: "success", text: "Gmail connected. New inbox messages will now reach the assistant." },
  googlecalendar: { tone: "success", text: "Google Calendar connected." },
  connection_failed: { tone: "error", text: "The connection could not be completed. Try again." },
  invalid_callback: { tone: "error", text: "That connection link was not valid." },
};

export default function SettingsPage({ searchParams }: PageProps<"/settings">) {
  return (
    <>
      <PageHeader
        title="Settings"
        description="Connected accounts, scheduling preferences and the documents the assistant answers from."
      />
      <Suspense fallback={<SettingsSkeleton />}>
        <SettingsContent searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function SettingsContent({ searchParams }: Pick<PageProps<"/settings">, "searchParams">) {
  const user = await requireUser();
  const [params, connections, settings] = await Promise.all([
    searchParams,
    getConnections(user.id),
    getSettings(user.id),
  ]);
  const noticeKey = [params.connected, params.error].flat().find(Boolean);
  const notice = noticeKey ? NOTICES[noticeKey] : undefined;
  const gmail = connections.gmail;

  return (
    <div className="space-y-6">
      {notice && (
        <Alert variant={notice.tone === "error" ? "destructive" : "default"}>
          {notice.tone === "error" ? <CircleAlert aria-hidden /> : <CircleCheck aria-hidden />}
          <AlertDescription>{notice.text}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Integrations</CardTitle>
          <CardDescription>
            Accounts are connected through Composio. The assistant can only read until you
            approve a proposal.
          </CardDescription>
        </CardHeader>
        <CardContent className="divide-y">
          <IntegrationRow
            toolkit="gmail"
            icon={<Mail aria-hidden />}
            name="Gmail"
            connected={Boolean(gmail)}
            detail={
              gmail
                ? [
                    gmail.accountEmail,
                    gmail.triggerType === "poll"
                      ? `New-message trigger polls every ${gmail.triggerPollingMinutes ?? "few"} min`
                      : "New-message trigger is realtime",
                  ]
                    .filter(Boolean)
                    .join(" · ")
                : "Required. Incoming mail starts the assistant."
            }
          />
          <IntegrationRow
            toolkit="googlecalendar"
            icon={<Calendar aria-hidden />}
            name="Google Calendar"
            connected={Boolean(connections.googlecalendar)}
            detail={
              connections.googlecalendar
                ? "Used to check availability and create approved events."
                : "Optional. Without it the assistant will not propose meeting times."
            }
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Scheduling</CardTitle>
          <CardDescription>
            Meeting proposals are limited to these hours, in this timezone.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SchedulingForm settings={settings} timezones={Intl.supportedValuesOf("timeZone")} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Business context</CardTitle>
          <CardDescription>
            Version-controlled documents in <code className="font-mono text-xs">demo-data/</code>.
            Replies may only state facts found here.
          </CardDescription>
        </CardHeader>
        <CardContent className="divide-y">
          {Object.entries(COMPANY_DOCUMENTS).map(([id, document]) => (
            <div key={id} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
              <FileText className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
              <div className="min-w-0 space-y-0.5">
                <p className="text-sm font-medium">{document.title}</p>
                <p className="text-sm text-muted-foreground">{document.description}</p>
              </div>
              <code className="ml-auto shrink-0 font-mono text-xs text-muted-foreground">
                {id}.md
              </code>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function IntegrationRow({
  toolkit,
  icon,
  name,
  connected,
  detail,
}: {
  toolkit: Toolkit;
  icon: React.ReactNode;
  name: string;
  connected: boolean;
  detail: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 py-4 first:pt-0 last:pb-0">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-md border bg-muted/50 [&_svg]:size-4">
        {icon}
      </span>
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium">{name}</p>
          <Badge variant={connected ? "secondary" : "outline"}>
            {connected ? "Connected" : "Not connected"}
          </Badge>
        </div>
        <p className="truncate text-sm text-muted-foreground">{detail}</p>
      </div>
      <form action={connected ? disconnectToolkit : connectToolkit}>
        <input type="hidden" name="toolkit" value={toolkit} />
        <Button type="submit" size="sm" variant={connected ? "outline" : "default"}>
          {connected ? "Disconnect" : "Connect"}
        </Button>
      </form>
    </div>
  );
}

function SettingsSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true">
      <Skeleton className="h-52 w-full rounded-xl" />
      <Skeleton className="h-44 w-full rounded-xl" />
      <Skeleton className="h-56 w-full rounded-xl" />
    </div>
  );
}
