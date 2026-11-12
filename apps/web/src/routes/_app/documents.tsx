import {
  Button,
  Card,
  cn,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FormField,
  Input,
  Skeleton,
  StatusPill,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  textStyle,
  toast,
} from "@crowhr/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Download, FilePlus2, Trash2, Upload } from "lucide-react";
import * as React from "react";
import { useReauth } from "../../auth/reauth.tsx";
import { can, useMe } from "../../auth/session.ts";
import { PageHeader } from "../../components/page-header.tsx";
import { ErrorNote } from "../../components/section.tsx";
import {
  acknowledgementsQuery,
  type Doc,
  documentsQuery,
  errorText,
  requestsQuery,
  retentionQuery,
  sgDay,
} from "../../documents/api.ts";
import {
  DocumentSheet,
  DocumentsEmpty,
  DocumentsPager,
  DocumentTable,
  invalidateDocuments,
  RequestLetterDialog,
  UploadDialog,
} from "../../documents/ui.tsx";
import { ApiError, apiPost } from "../../lib/api.ts";

const TABS = ["mine", "expiring", "acknowledgements", "retention", "deleted"] as const;
type Tab = (typeof TABS)[number];

export const Route = createFileRoute("/_app/documents")({
  validateSearch: (s: Record<string, unknown>): { open?: string; tab?: Tab } => ({
    open: typeof s.open === "string" ? s.open : undefined,
    tab: TABS.includes(s.tab as Tab) ? (s.tab as Tab) : undefined,
  }),
  component: DocumentsPage,
});

function DocumentsPage() {
  const me = useMe();
  const { open, tab } = Route.useSearch();
  const navigate = Route.useNavigate();
  const isHr = can(me, "documents:update");
  const isOwner = me.roles.includes("owner");
  const hasEmployee = !!me.employeeId;
  const current: Tab = tab ?? (hasEmployee ? "mine" : "expiring");
  const [upload, setUpload] = React.useState(false);
  const [request, setRequest] = React.useState(false);
  const mine = useQuery({ ...documentsQuery({ mine: "true" }), enabled: hasEmployee });
  const [openDoc, setOpenDoc] = React.useState<Doc | null>(null);
  // `?open=<id>` from Home and notifications.
  const items = mine.data?.items;
  React.useEffect(() => {
    if (open && !openDoc) {
      const found = items?.find((d) => d.id === open);
      if (found) setOpenDoc(found);
    }
  }, [open, items, openDoc]);
  const sheetDoc = openDoc ? (items?.find((d) => d.id === openDoc.id) ?? openDoc) : null;
  const close = () => {
    setOpenDoc(null);
    if (open) void navigate({ search: (s) => ({ ...s, open: undefined }), replace: true });
  };
  const setTab = (t: string) => void navigate({ search: (s) => ({ ...s, tab: t as Tab }), replace: true });

  return (
    <>
      <PageHeader
        title="Documents"
        description={
          isHr
            ? "Your own documents, and the organisation's expiring documents, acknowledgements and retention reviews. Employee files are on each person's Documents tab."
            : "Your contracts, letters, passes and certificates. Open a document HR asked you to acknowledge, then confirm you've read it."
        }
        actions={
          hasEmployee ? (
            <>
              <Button size="sm" onClick={() => setUpload(true)}>
                <Upload aria-hidden /> Upload
              </Button>
              <Button size="sm" onClick={() => setRequest(true)}>
                <FilePlus2 aria-hidden /> Request a letter
              </Button>
            </>
          ) : null
        }
      />
      <Tabs value={current} onValueChange={setTab}>
        {isHr ? (
          <TabsList className="mb-4 max-w-full overflow-x-auto">
            {hasEmployee ? <TabsTrigger value="mine">My documents</TabsTrigger> : null}
            <TabsTrigger value="expiring">Expiring</TabsTrigger>
            <TabsTrigger value="acknowledgements">Acknowledgements</TabsTrigger>
            <TabsTrigger value="retention">Retention review</TabsTrigger>
            {isOwner ? <TabsTrigger value="deleted">Deleted</TabsTrigger> : null}
          </TabsList>
        ) : null}
        <TabsContent value="mine">
          <MyDocuments docs={mine.data?.items} error={mine.error} loading={mine.isPending} onOpen={setOpenDoc} />
          {hasEmployee ? <MyRequests /> : null}
        </TabsContent>
        {isHr ? (
          <>
            <TabsContent value="expiring">
              <Expiring onOpen={setOpenDoc} />
            </TabsContent>
            <TabsContent value="acknowledgements">
              <Acknowledgements />
            </TabsContent>
            <TabsContent value="retention">
              <Retention />
            </TabsContent>
            {isOwner ? (
              <TabsContent value="deleted">
                <Deleted />
              </TabsContent>
            ) : null}
          </>
        ) : null}
      </Tabs>
      <DocumentSheet doc={sheetDoc} onClose={close} />
      {hasEmployee ? (
        <>
          <UploadDialog open={upload} onOpenChange={setUpload} employeeId={me.employeeId as string} self />
          <RequestLetterDialog open={request} onOpenChange={setRequest} />
        </>
      ) : null}
    </>
  );
}

function MyDocuments({
  docs,
  error,
  loading,
  onOpen,
}: {
  docs: Doc[] | undefined;
  error: unknown;
  loading: boolean;
  onOpen: (d: Doc) => void;
}) {
  const toAck = (docs ?? []).filter((d) => d.acknowledgement?.status === "requested" && d.acknowledgement.current);
  return (
    <div className="flex flex-col gap-4">
      {toAck.length ? (
        <Card className="border-ink/25 p-4" data-testid="to-acknowledge">
          <h2 className={cn("mb-2", textStyle.section)}>
            To read and acknowledge <span className="num">({toAck.length})</span>
          </h2>
          <ul className="flex flex-col gap-1">
            {toAck.map((d) => (
              <li key={d.id}>
                <button
                  type="button"
                  className="focus-ring rounded-sm text-left text-biru-400 underline"
                  onClick={() => onOpen(d)}
                >
                  {d.title}
                </button>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
      <Card>
        {error ? (
          <ErrorNote error={error} />
        ) : loading ? (
          <div className="p-4">
            <Skeleton className="h-24 w-full" />
          </div>
        ) : !docs?.length ? (
          <DocumentsEmpty
            title="HR hasn't shared any documents with you yet."
            description="Your contract, letters and anything else HR shares with you appear here. Need a letter? Use Request a letter."
          />
        ) : (
          <DocumentTable docs={docs} onOpen={onOpen} label="My documents" />
        )}
      </Card>
    </div>
  );
}

function MyRequests() {
  const q = useQuery(requestsQuery);
  const items = q.data?.items ?? [];
  if (!items.length) return null;
  const tone = (s: string) =>
    s === "approved" ? "success" : s === "rejected" ? "danger" : s === "pending" ? "info" : "neutral";
  const label: Record<string, string> = {
    pending: "With HR",
    approved: "Approved",
    rejected: "Not approved",
    withdrawn: "Withdrawn",
  };
  return (
    <section className="mt-6" aria-labelledby="letter-requests">
      <h2 id="letter-requests" className={cn("mb-2", textStyle.section)}>
        Letter requests
      </h2>
      <Card>
        <Table aria-label="Letter requests">
          <TableHeader>
            <TableRow>
              <TableHead>Purpose</TableHead>
              <TableHead>Status</TableHead>
              <TableHead numeric>Requested</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((r) => (
              <TableRow key={r.id}>
                <TableCell>{r.purpose}</TableCell>
                <TableCell>
                  <StatusPill tone={tone(r.status)}>{label[r.status] ?? r.status}</StatusPill>
                </TableCell>
                <TableCell numeric>{sgDay(r.createdAt)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </section>
  );
}

function Expiring({ onOpen }: { onOpen: (d: Doc) => void }) {
  const [page, setPage] = React.useState(1);
  const q = useQuery(documentsQuery({ expiry: "attention" }, page));
  return (
    <Card>
      {q.isError ? (
        <ErrorNote error={q.error} retry={() => void q.refetch()} />
      ) : q.isPending ? (
        <div className="p-4">
          <Skeleton className="h-24 w-full" />
        </div>
      ) : !q.data.items.length ? (
        <DocumentsEmpty
          title="No document expires in the next 30 days."
          description="Documents that expire within 30 days, or have expired, appear here. Reminders go out 30 and 7 days before and on the day."
        />
      ) : (
        <DocumentTable docs={q.data.items} onOpen={onOpen} showEmployee label="Expiring and expired documents" />
      )}
      <DocumentsPager list={q.data} page={page} onPage={setPage} />
    </Card>
  );
}

function Acknowledgements() {
  const [status, setStatus] = React.useState<"outstanding" | "completed">("outstanding");
  const q = useQuery(acknowledgementsQuery(status));
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {(["outstanding", "completed"] as const).map((s) => (
          <Button
            key={s}
            size="sm"
            variant={status === s ? "ink" : "secondary"}
            onClick={() => setStatus(s)}
            aria-pressed={status === s}
          >
            {s === "outstanding" ? "Outstanding" : "Completed"}
          </Button>
        ))}
        <Button asChild size="sm" variant="ghost">
          <a href="/api/v1/documents/acknowledgements?format=csv" download>
            <Download aria-hidden /> CSV
          </a>
        </Button>
      </div>
      <Card>
        {q.isError ? (
          <ErrorNote error={q.error} retry={() => void q.refetch()} />
        ) : q.isPending ? (
          <div className="p-4">
            <Skeleton className="h-24 w-full" />
          </div>
        ) : !q.data.items.length ? (
          <DocumentsEmpty
            title={
              status === "outstanding"
                ? "Everyone has acknowledged what they were sent."
                : "No acknowledgements asked for yet."
            }
            description="Ask for an acknowledgement from a document on the employee's Documents tab."
          />
        ) : (
          <div className="overflow-x-auto">
            <Table aria-label="Acknowledgements">
              <TableHeader>
                <TableRow>
                  <TableHead>Document</TableHead>
                  <TableHead>Employee</TableHead>
                  <TableHead numeric>Requested</TableHead>
                  <TableHead numeric>Acknowledged</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {q.data.items.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell>
                      {a.documentTitle} <span className="num text-2xs text-primary-300">v{a.version}</span>
                    </TableCell>
                    <TableCell>
                      <Link
                        to="/people/$employeeId"
                        params={{ employeeId: a.employeeId }}
                        search={{ tab: "documents" }}
                        className="text-biru-400 underline"
                      >
                        {a.employeeName}
                      </Link>
                    </TableCell>
                    <TableCell numeric>{sgDay(a.requestedAt)}</TableCell>
                    <TableCell numeric>{a.acknowledgedAt ? sgDay(a.acknowledgedAt) : "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>
    </div>
  );
}

function Retention() {
  const qc = useQueryClient();
  const q = useQuery(retentionQuery);
  const decide = useMutation({
    mutationFn: (v: { id: string; resolution: "keep" | "delete" }) =>
      apiPost(
        `/api/v1/documents/retention/${v.id}/resolve`,
        v.resolution === "keep"
          ? { resolution: "keep", keepMonths: 12 }
          : { resolution: "delete", reason: "No longer needed after the keeping period" },
      ),
    onSuccess: async (_r, v) => {
      toast.success(
        v.resolution === "keep" ? "Kept for another 12 months" : "Deleted. An owner can purge it permanently.",
      );
      await invalidateDocuments(qc);
    },
    onError: (e) => toast.error(errorText(e)),
  });
  return (
    <div className="flex flex-col gap-3">
      <p className="max-w-3xl text-ui text-primary-300">
        The Employment Act asks you to keep an ex-employee's records for a year after they leave. After that, documents
        are listed here for a decision. Nothing is deleted unless you choose to; tax and CPF records may need to be kept
        longer.
      </p>
      <Card>
        {q.isError ? (
          <ErrorNote error={q.error} retry={() => void q.refetch()} />
        ) : q.isPending ? (
          <div className="p-4">
            <Skeleton className="h-24 w-full" />
          </div>
        ) : !q.data.items.length ? (
          <DocumentsEmpty
            title="No document is past its keeping period."
            description="Documents kept longer than their category's retention period appear here for review."
          />
        ) : (
          <div className="overflow-x-auto">
            <Table aria-label="Retention review">
              <TableHeader>
                <TableRow>
                  <TableHead>Document</TableHead>
                  <TableHead>Employee</TableHead>
                  <TableHead>Why</TableHead>
                  <TableHead>
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {q.data.items.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      {r.documentTitle} <span className="text-2xs text-primary-300">{r.category}</span>
                    </TableCell>
                    <TableCell>{r.employeeName}</TableCell>
                    <TableCell className="text-2xs text-primary-300">{r.reason}</TableCell>
                    <TableCell className="whitespace-nowrap text-right">
                      <Button size="sm" onClick={() => decide.mutate({ id: r.id, resolution: "keep" })}>
                        Keep
                      </Button>{" "}
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => decide.mutate({ id: r.id, resolution: "delete" })}
                      >
                        Delete
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>
    </div>
  );
}

/** Owners only: deleted documents (hidden, still stored) and the irreversible purge. */
function Deleted() {
  const [page, setPage] = React.useState(1);
  const q = useQuery(documentsQuery({ deleted: "true" }, page));
  const [purging, setPurging] = React.useState<Doc | null>(null);
  return (
    <div className="flex flex-col gap-3">
      <p className="max-w-3xl text-ui text-primary-300">
        Deleted documents are hidden from everyone but still stored, with their history in the audit log. Purging
        removes the files for good. Only owners can purge, and it can't be undone.
      </p>
      <Card>
        {q.isError ? (
          <ErrorNote error={q.error} retry={() => void q.refetch()} />
        ) : q.isPending ? (
          <div className="p-4">
            <Skeleton className="h-24 w-full" />
          </div>
        ) : !q.data.items.length ? (
          <DocumentsEmpty
            title="No deleted documents."
            description="Documents you delete are kept here until they are purged."
          />
        ) : (
          <div className="overflow-x-auto">
            <Table aria-label="Deleted documents">
              <TableHeader>
                <TableRow>
                  <TableHead>Document</TableHead>
                  <TableHead>Employee</TableHead>
                  <TableHead numeric>Deleted</TableHead>
                  <TableHead>
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {q.data.items.map((d) => (
                  <TableRow key={d.id} data-testid="deleted-document">
                    <TableCell>
                      {d.title} <span className="text-2xs text-primary-300">{d.category.name}</span>
                    </TableCell>
                    <TableCell>{d.employeeName}</TableCell>
                    <TableCell numeric>{d.deletedAt ? sgDay(d.deletedAt) : "—"}</TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="ghost" onClick={() => setPurging(d)}>
                        <Trash2 aria-hidden /> Purge
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        <DocumentsPager list={q.data} page={page} onPage={setPage} />
      </Card>
      <PurgeDialog doc={purging} onClose={() => setPurging(null)} />
    </div>
  );
}

function PurgeDialog({ doc, onClose }: { doc: Doc | null; onClose: () => void }) {
  const qc = useQueryClient();
  const withReauth = useReauth();
  const [typed, setTyped] = React.useState("");
  const [reason, setReason] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (doc) {
      setTyped("");
      setReason("");
      setError(null);
    }
  }, [doc]);
  const purge = useMutation({
    mutationFn: (d: Doc) => withReauth(() => apiPost(`/api/v1/documents/${d.id}/purge`, { reason: reason.trim() })),
    onSuccess: async () => {
      toast.success("Document purged");
      await invalidateDocuments(qc);
      onClose();
    },
    onError: (e) => {
      if (!(e instanceof ApiError && e.code === "reauth_required")) setError(errorText(e));
    },
  });
  const matches = !!doc && typed.trim() === doc.title.trim();
  return (
    <Dialog open={!!doc} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Purge this document?</DialogTitle>
          <DialogDescription>
            This permanently removes every version's file. It can't be undone; the audit log keeps only that it
            happened.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (doc && matches && reason.trim()) purge.mutate(doc);
          }}
        >
          <FormField label="Why purge it?" required hint="For example: uploaded to the wrong employee.">
            <Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} />
          </FormField>
          <FormField label={`Type the document title to confirm: ${doc?.title ?? ""}`} required>
            <Input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" spellCheck={false} />
          </FormField>
          {error ? (
            <p role="alert" className="text-ui text-danger-300">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="destructive" disabled={!matches || !reason.trim() || purge.isPending}>
              Purge permanently
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
