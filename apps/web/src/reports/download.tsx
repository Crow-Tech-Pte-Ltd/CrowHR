import { useMutation } from "@tanstack/react-query";
import { useReauth } from "../auth/reauth.tsx";
import { ErrorNote } from "../components/section.tsx";
import { useT } from "../i18n/index.ts";
import { downloadApiFile } from "../lib/download.ts";

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
