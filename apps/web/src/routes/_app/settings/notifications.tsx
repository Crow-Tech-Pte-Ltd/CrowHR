import {
  Alert,
  AlertDescription,
  AlertTitle,
  formatDate,
  Label,
  Skeleton,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  toast,
} from "@crowhr/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { MailWarning } from "lucide-react";
import { can, useMe } from "../../../auth/session.ts";
import { PageHeader } from "../../../components/page-header.tsx";
import { ErrorNote, Section } from "../../../components/section.tsx";
import { apiGet, apiPut } from "../../../lib/api.ts";
import { sgDate } from "../../../workflows/format.ts";

export const Route = createFileRoute("/_app/settings/notifications")({
  component: NotificationSettingsPage,
});

interface Prefs {
  emailConfigured: boolean;
  categories: { category: string; label: string; description: string; emailEnabled: boolean; locked: boolean }[];
}

interface Delivery {
  emailConfigured: boolean;
  setupHelp: string | null;
  counts: { queued: number; sent: number; failed: number; suppressed: number };
  failed: { id: string; to: string; kind: string; attempts: number; lastError: string | null; createdAt: string }[];
}

const prefsQuery = {
  queryKey: ["notifications", "prefs"] as const,
  queryFn: () => apiGet<Prefs>("/api/v1/notifications/preferences"),
};

function NotificationSettingsPage() {
  const me = useMe();
  const qc = useQueryClient();
  const prefs = useQuery(prefsQuery);
  const isOwner = can(me, "notification_delivery:read");
  const delivery = useQuery({
    queryKey: ["notifications", "delivery"],
    queryFn: () => apiGet<Delivery>("/api/v1/notifications/delivery"),
    enabled: isOwner,
  });
  const save = useMutation({
    mutationFn: (input: { category: string; enabled: boolean }) =>
      apiPut("/api/v1/notifications/preferences", { email: { [input.category]: input.enabled } }),
    onMutate: async ({ category, enabled }) => {
      await qc.cancelQueries({ queryKey: prefsQuery.queryKey });
      const before = qc.getQueryData<Prefs>(prefsQuery.queryKey);
      if (before) {
        qc.setQueryData<Prefs>(prefsQuery.queryKey, {
          ...before,
          categories: before.categories.map((c) => (c.category === category ? { ...c, emailEnabled: enabled } : c)),
        });
      }
      return { before };
    },
    onError: (err, _v, ctx) => {
      if (ctx?.before) qc.setQueryData(prefsQuery.queryKey, ctx.before);
      toast.error("Not saved", { description: err instanceof Error ? err.message : "Try again." });
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: prefsQuery.queryKey }),
  });

  return (
    <>
      <PageHeader
        crumbs={[{ label: "Settings", to: "/settings" }]}
        title="Notifications"
        description="Everything shows in Crow HR under the bell, top right. Choose what is also emailed to you."
      />

      {isOwner ? <DeliverySection delivery={delivery} /> : null}

      <Section id="email-prefs" title="Email me about" description="Your own choice; other members choose theirs.">
        {prefs.isPending ? (
          <div className="flex flex-col gap-3 p-4">
            <Skeleton className="h-6 w-full" />
            <Skeleton className="h-6 w-full" />
          </div>
        ) : prefs.isError ? (
          <ErrorNote error={prefs.error} retry={() => void prefs.refetch()} />
        ) : (
          <>
            {!prefs.data.emailConfigured ? (
              <p className="border-b border-border px-4 py-3 text-ui text-primary-300">
                This server doesn't send email yet, so these apply once an owner sets it up. You still get every
                notification in Crow HR.
              </p>
            ) : null}
            <ul className="divide-y divide-border">
              {prefs.data.categories.map((c) => (
                <li key={c.category} className="flex items-center justify-between gap-4 px-4 py-3">
                  <Label htmlFor={`pref-${c.category}`} className="flex flex-col gap-0.5 font-sans font-normal">
                    <span className="font-azeret text-xs font-semibold">{c.label}</span>
                    <span className="text-ui text-primary-300">{c.description}</span>
                  </Label>
                  <Switch
                    id={`pref-${c.category}`}
                    checked={c.emailEnabled}
                    disabled={c.locked}
                    onCheckedChange={(enabled) => save.mutate({ category: c.category, enabled })}
                  />
                </li>
              ))}
            </ul>
          </>
        )}
      </Section>
    </>
  );
}

function DeliverySection({ delivery }: { delivery: ReturnType<typeof useQuery<Delivery>> }) {
  if (delivery.isPending) {
    return (
      <div className="mb-8">
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }
  if (delivery.isError) {
    return (
      <div className="mb-8">
        <ErrorNote error={delivery.error} retry={() => void delivery.refetch()} />
      </div>
    );
  }
  const d = delivery.data;
  if (!d.emailConfigured) {
    return (
      <Alert variant="warning" className="mb-8" data-testid="email-not-configured">
        <MailWarning aria-hidden />
        <div className="flex flex-col gap-1.5">
          <AlertTitle>Email is not configured</AlertTitle>
          <AlertDescription>
            Crow HR works fully without email: notifications appear in the app, and invitations and password resets give
            you a link to copy. To also send email, {d.setupHelp?.replace(/^Set /, "set ")}
          </AlertDescription>
        </div>
      </Alert>
    );
  }
  return (
    <Section
      id="delivery"
      title="Email delivery"
      description="Emails are retried for about 15 hours (after 1, 5, 30, 120 and 720 minutes) before they count as failed."
    >
      <dl className="grid grid-cols-3 gap-4 border-b border-border px-4 py-3">
        {(
          [
            ["Waiting", d.counts.queued],
            ["Sent", d.counts.sent],
            ["Failed", d.counts.failed],
          ] as const
        ).map(([label, n]) => (
          <div key={label}>
            <dt className="font-azeret text-[10px] uppercase tracking-wider text-primary-200">{label}</dt>
            <dd className="num text-sm font-medium">{n}</dd>
          </div>
        ))}
      </dl>
      {d.failed.length === 0 ? (
        <p className="px-4 py-3 text-ui text-primary-300">No failed emails.</p>
      ) : (
        <Table aria-label="Failed emails">
          <TableHeader>
            <TableRow>
              <TableHead>To</TableHead>
              <TableHead>Kind</TableHead>
              <TableHead className="text-right">Attempts</TableHead>
              <TableHead>Last error</TableHead>
              <TableHead className="text-right">Queued</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {d.failed.map((f) => (
              <TableRow key={f.id}>
                <TableCell className="num">{f.to}</TableCell>
                <TableCell>{f.kind.replace(/_/g, " ")}</TableCell>
                <TableCell className="num text-right">{f.attempts}</TableCell>
                <TableCell className="max-w-[18rem] truncate text-primary-300">{f.lastError}</TableCell>
                <TableCell className="num text-right">{formatDate(sgDate(f.createdAt))}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Section>
  );
}
