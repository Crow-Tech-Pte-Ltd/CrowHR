import { Button, Card, Skeleton } from "@crowhr/ui";
import { useQuery } from "@tanstack/react-query";
import { FileSignature, Upload } from "lucide-react";
import * as React from "react";
import { can, useMe } from "../auth/session.ts";
import { ErrorNote } from "../components/section.tsx";
import { type Doc, documentsQuery } from "./api.ts";
import { DocumentSheet, DocumentsEmpty, DocumentTable, GenerateDialog, UploadDialog } from "./ui.tsx";

/** The employee profile's Documents tab: their files by category, upload, generate a letter. */
export function EmployeeDocuments({ employeeId, employeeName }: { employeeId: string; employeeName: string }) {
  const me = useMe();
  const hr = can(me, "documents:update");
  const q = useQuery(documentsQuery({ employeeId }));
  const [open, setOpen] = React.useState<Doc | null>(null);
  const [upload, setUpload] = React.useState(false);
  const [generate, setGenerate] = React.useState(false);
  const docs = q.data?.items ?? [];
  const current = open ? (docs.find((d) => d.id === open.id) ?? open) : null;
  return (
    <div className="flex flex-col gap-3">
      {hr ? (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => setUpload(true)}>
            <Upload aria-hidden /> Upload
          </Button>
          <Button size="sm" variant="primary" onClick={() => setGenerate(true)} data-testid="open-generate">
            <FileSignature aria-hidden /> Generate letter
          </Button>
        </div>
      ) : null}
      <Card>
        {q.isError ? (
          <ErrorNote error={q.error} retry={() => void q.refetch()} />
        ) : q.isPending ? (
          <div className="p-4">
            <Skeleton className="h-24 w-full" />
          </div>
        ) : !docs.length ? (
          <DocumentsEmpty
            title="No documents yet"
            description={
              hr
                ? `Upload ${employeeName}'s contract, pass copies and certificates, or generate a letter such as their KETs.`
                : "Documents you may see for this person appear here."
            }
          />
        ) : (
          <DocumentTable docs={docs} onOpen={setOpen} label={`${employeeName}'s documents`} />
        )}
      </Card>
      <DocumentSheet doc={current} onClose={() => setOpen(null)} />
      {hr ? (
        <>
          <UploadDialog open={upload} onOpenChange={setUpload} employeeId={employeeId} self={false} />
          <GenerateDialog open={generate} onOpenChange={setGenerate} employeeId={employeeId} defaultKind="ket" />
        </>
      ) : null}
    </div>
  );
}
