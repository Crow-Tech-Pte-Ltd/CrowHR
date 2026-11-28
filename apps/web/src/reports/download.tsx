import { Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@crowhr/ui";
import { useMutation } from "@tanstack/react-query";
import { ChevronDown, Download } from "lucide-react";
import { useReauth } from "../auth/reauth.tsx";
import { ErrorNote } from "../components/section.tsx";
import { useT } from "../i18n/index.ts";
import { downloadApiFile } from "../lib/download.ts";
import { REPORT_EXPORT_FORMATS } from "./api.ts";

type ReportExportFormat = (typeof REPORT_EXPORT_FORMATS)[number];

export function DownloadMenu({
  label,
  ariaLabel,
  disabled,
  formats = REPORT_EXPORT_FORMATS,
  onChoose,
}: {
  label: string;
  ariaLabel?: string;
  disabled: boolean;
  formats?: readonly ReportExportFormat[];
  onChoose: (format: ReportExportFormat["id"]) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" disabled={disabled} className="shrink-0" aria-label={ariaLabel}>
          <Download aria-hidden /> {label} <ChevronDown aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {formats.map(({ id, label: formatLabel }) => (
          <DropdownMenuItem key={id} onSelect={() => onChoose(id)}>
            {formatLabel} (.{id})
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function useExportDownload() {
  const withReauth = useReauth();
  return useMutation({ mutationFn: (path: string) => withReauth(() => downloadApiFile(path)) });
}

export function DownloadFeedback({ download }: { download: ReturnType<typeof useExportDownload> }) {
  const t = useT("people-payroll");
  return (
    <>
      <p
        role="status"
        className={download.isPending || download.isSuccess ? "mb-4 text-ui text-primary-300" : "sr-only"}
      >
        {download.isPending
          ? t("Preparing download…")
          : download.data
            ? `Download started for ${download.data.fileName}.`
            : ""}
      </p>
      {download.isError ? <ErrorNote error={download.error} /> : null}
    </>
  );
}
