import {
  Button,
  Card,
  cn,
  FormField,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  StatusPill,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
  textStyle,
  toast,
} from "@crowhr/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import * as React from "react";
import { PageHeader } from "../../../components/page-header.tsx";
import { ErrorNote, Section } from "../../../components/section.tsx";
import {
  type Block,
  categoriesQuery,
  type DocCategory,
  errorText,
  fieldsQuery,
  LETTER_KIND_LABEL,
  type LetterTemplate,
  templatesQuery,
} from "../../../documents/api.ts";
import { LetterPreview } from "../../../documents/letter-preview.tsx";
import { invalidateDocuments } from "../../../documents/ui.tsx";
import { useT } from "../../../i18n/index.ts";
import { apiPatch, apiPost, apiPut } from "../../../lib/api.ts";

export const Route = createFileRoute("/_app/settings/documents")({
  component: DocumentSettings,
});

function DocumentSettings() {
  const t = useT("settings-account");
  return (
    <>
      <PageHeader
        crumbs={[{ label: t("Settings"), to: "/settings" }]}
        title={t("Documents")}
        description={t(
          "Who can see each category of employee document, and the letter templates HR generates from employee records.",
        )}
      />
      <Categories />
      <Templates />
    </>
  );
}

const FLAGS: { key: keyof DocCategory; label: string }[] = [
  { key: "employeeVisible", label: "Employee sees" },
  { key: "managerVisible", label: "Manager sees" },
  { key: "payrollVisible", label: "Payroll sees" },
  { key: "employeeUploadable", label: "Employee uploads" },
  { key: "expiryRequired", label: "Expiry required" },
];

function Categories() {
  const t = useT("settings-account");
  const qc = useQueryClient();
  const q = useQuery(categoriesQuery);
  const [name, setName] = React.useState("");
  const patch = useMutation({
    mutationFn: (v: { id: string; patch: Partial<DocCategory> }) =>
      apiPatch(`/api/v1/documents/categories/${v.id}`, v.patch),
    onSuccess: () => invalidateDocuments(qc),
    onError: (e) => toast.error(errorText(e)),
  });
  const create = useMutation({
    mutationFn: () => apiPost("/api/v1/documents/categories", { name }),
    onSuccess: async () => {
      setName("");
      await invalidateDocuments(qc);
    },
    onError: (e) => toast.error(errorText(e)),
  });
  return (
    <Section
      id="doc-categories"
      title={t("Categories")}
      description={t(
        "Medical documents are visible only to HR, owners and the employee. Views of medical and identity documents are audit-logged.",
      )}
    >
      {q.isError ? (
        <ErrorNote error={q.error} retry={() => void q.refetch()} />
      ) : q.isPending ? (
        <div className="p-4">
          <Skeleton className="h-24 w-full" />
        </div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <Table aria-label={t("Document categories")}>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("Category")}</TableHead>
                  {FLAGS.map((f) => (
                    <TableHead key={f.key} className="text-center">
                      {t(f.label)}
                    </TableHead>
                  ))}
                  <TableHead numeric>{t("Documents")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {q.data.items.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="whitespace-nowrap font-medium">
                      {c.name}{" "}
                      {c.sensitivity === "medical" ? <StatusPill tone="warning">{t("Medical")}</StatusPill> : null}
                    </TableCell>
                    {FLAGS.map((f) => {
                      const locked = f.key === "managerVisible" && c.sensitivity === "medical";
                      return (
                        <TableCell key={f.key} className="text-center">
                          <Switch
                            aria-label={t("{name}: {label}", { name: c.name, label: t(f.label) })}
                            checked={Boolean(c[f.key])}
                            disabled={locked || patch.isPending}
                            title={locked ? t("Medical documents are never shown to managers.") : undefined}
                            onCheckedChange={(v) => patch.mutate({ id: c.id, patch: { [f.key]: v } })}
                          />
                        </TableCell>
                      );
                    })}
                    <TableCell numeric>{c.documentCount}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <form
            className="flex flex-wrap items-end gap-2 border-t border-ink/10 p-3"
            onSubmit={(e) => {
              e.preventDefault();
              create.mutate();
            }}
          >
            <FormField label={t("New category")}>
              <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} className="w-64" />
            </FormField>
            <Button type="submit" size="sm" disabled={!name.trim() || create.isPending}>
              <Plus aria-hidden /> {t("Add")}
            </Button>
          </form>
        </>
      )}
    </Section>
  );
}

function Templates() {
  const t = useT("settings-account");
  const q = useQuery(templatesQuery);
  const [editing, setEditing] = React.useState<LetterTemplate | "new" | null>(null);
  return (
    <Section
      id="doc-templates"
      title={t("Letter templates")}
      description={t(
        "Restricted Markdown with {{merge.fields}}. The KET template keeps every MOM mandatory item; you can reword it but not remove one.",
      )}
      actions={
        <Button size="sm" onClick={() => setEditing("new")}>
          <Plus aria-hidden /> {t("New template")}
        </Button>
      }
    >
      {q.isError ? (
        <ErrorNote error={q.error} retry={() => void q.refetch()} />
      ) : q.isPending ? (
        <div className="p-4">
          <Skeleton className="h-24 w-full" />
        </div>
      ) : (
        <Table aria-label={t("Letter templates")}>
          <TableHeader>
            <TableRow>
              <TableHead>{t("Template")}</TableHead>
              <TableHead>{t("Kind")}</TableHead>
              <TableHead numeric>{t("Version")}</TableHead>
              <TableHead>
                <span className="sr-only">{t("Actions")}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {q.data.items.map((template) => (
              <TableRow key={template.id}>
                <TableCell className="font-medium">
                  {template.name}{" "}
                  {template.usesSalary ? <StatusPill tone="neutral">{t("Salary fields")}</StatusPill> : null}
                  {!template.active ? <StatusPill tone="neutral">{t("Inactive")}</StatusPill> : null}
                </TableCell>
                <TableCell className="text-primary-300">
                  {t(LETTER_KIND_LABEL[template.kind] ?? template.kind)}
                </TableCell>
                <TableCell numeric>{template.version}</TableCell>
                <TableCell className="text-right">
                  <Button size="sm" variant="ghost" onClick={() => setEditing(template)}>
                    {t("Edit")}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {editing ? (
        <TemplateEditor template={editing === "new" ? null : editing} onClose={() => setEditing(null)} />
      ) : null}
    </Section>
  );
}

function TemplateEditor({ template, onClose }: { template: LetterTemplate | null; onClose: () => void }) {
  const t = useT("settings-account");
  const qc = useQueryClient();
  const fields = useQuery(fieldsQuery);
  const [name, setName] = React.useState(template?.name ?? "");
  const [kind, setKind] = React.useState(template?.kind ?? "custom");
  const [body, setBody] = React.useState(
    template?.bodyMd ?? "# Letter\n\n{{today}}\n\nDear {{employee.preferred_name}},\n\n",
  );
  const [check, setCheck] = React.useState<{ issues: { line: number; message: string }[]; blocks: Block[] } | null>(
    null,
  );
  const textRef = React.useRef<HTMLTextAreaElement>(null);
  const cardRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    cardRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, []);
  // Live check and preview, debounced.
  React.useEffect(() => {
    const t = setTimeout(() => {
      apiPost<{ issues: { line: number; message: string }[]; blocks: Block[] }>("/api/v1/documents/templates/check", {
        kind,
        bodyMd: body,
      })
        .then(setCheck)
        .catch(() => setCheck(null));
    }, 300);
    return () => clearTimeout(t);
  }, [body, kind]);
  const save = useMutation({
    mutationFn: () =>
      template
        ? apiPut(`/api/v1/documents/templates/${template.id}`, { name, kind, bodyMd: body })
        : apiPost("/api/v1/documents/templates", { name, kind, bodyMd: body }),
    onSuccess: async () => {
      toast.success(t("Template saved"));
      await invalidateDocuments(qc);
      onClose();
    },
    onError: (e) => toast.error(errorText(e)),
  });
  const insert = (id: string) => {
    const el = textRef.current;
    const token = `{{${id}}}`;
    if (!el) return setBody((b) => b + token);
    const start = el.selectionStart;
    setBody((b) => b.slice(0, start) + token + b.slice(el.selectionEnd));
    requestAnimationFrame(() => {
      el.focus();
      el.selectionStart = el.selectionEnd = start + token.length;
    });
  };
  const groups = new Map<string, { id: string; label: string; sensitivity?: string }[]>();
  for (const f of fields.data?.items ?? []) groups.set(f.group, [...(groups.get(f.group) ?? []), f]);
  return (
    <Card ref={cardRef} className="m-3 scroll-mt-20 border-ink/20 p-4" data-testid="template-editor">
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <FormField label={t("Name")}>
          <Input value={name} onChange={(e) => setName(e.target.value)} className="w-72" />
        </FormField>
        <FormField label={t("Kind")}>
          <Select value={kind} onValueChange={setKind} disabled={template?.kind === "ket"}>
            <SelectTrigger aria-label={t("Kind")} className="w-60">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(LETTER_KIND_LABEL).map(([k, l]) => (
                <SelectItem key={k} value={k}>
                  {l}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="flex flex-col gap-2">
          <FormField
            label={t("Body")}
            hint="# headings, **bold**, *italic*, - lists, | tables |, \pagebreak on its own line."
          >
            <Textarea
              ref={textRef}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={22}
              className="num text-2xs"
              spellCheck={false}
            />
          </FormField>
          {check?.issues.length ? (
            <ul role="alert" className="flex flex-col gap-1 text-ui text-danger-300" data-testid="template-issues">
              {check.issues.map((i) => (
                <li key={`${i.line}-${i.message}`}>{i.message}</li>
              ))}
            </ul>
          ) : null}
          <details>
            <summary className="cursor-pointer text-ui">{t("Insert a merge field")}</summary>
            <div className="mt-2 flex flex-col gap-2">
              {[...groups].map(([g, list]) => (
                <div key={g}>
                  <p className={cn("mb-1", textStyle.field)}>{g}</p>
                  <div className="flex flex-wrap gap-1">
                    {list.map((f) => (
                      <button
                        key={f.id}
                        type="button"
                        className="focus-ring num rounded-sm border border-ink/15 px-1.5 py-0.5 text-2xs hover:bg-ink/[0.04]"
                        title={t(f.label)}
                        onClick={() => insert(f.id)}
                      >
                        {f.id}
                        {f.sensitivity === "salary" ? t(" (salary)") : ""}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </details>
        </div>
        <div className="rounded-md border border-ink/10 bg-surface-50 p-4">
          <p className={cn("mb-3", textStyle.group)}>{t("Preview")}</p>
          {check ? <LetterPreview blocks={check.blocks} /> : <Skeleton className="h-40 w-full" />}
        </div>
      </div>
      <div className="mt-4 flex gap-2">
        <Button
          variant="primary"
          disabled={!name.trim() || !!check?.issues.length || save.isPending}
          onClick={() => save.mutate()}
        >
          {t("Save template")}
        </Button>
        <Button variant="ghost" onClick={onClose}>
          {t("Cancel")}
        </Button>
      </div>
    </Card>
  );
}
