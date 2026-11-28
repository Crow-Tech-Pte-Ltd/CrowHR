import { toast } from "@crowhr/ui";
import { type ComponentProps, useState } from "react";
import { useT } from "../i18n/index.ts";
import { downloadApiFile } from "../lib/download.ts";

type Props = Omit<ComponentProps<"a">, "href" | "download"> & {
  href: string;
  onDownloaded?: () => void;
};

/** Fetch through the app so downloads also reach the demo's browser-hosted API. */
export function ApiDownloadLink({ href, onClick, onDownloaded, ...props }: Props) {
  const t = useT("people-payroll");
  const [pending, setPending] = useState(false);
  return (
    <a
      {...props}
      href={href}
      download
      aria-busy={pending || undefined}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented) return;
        event.preventDefault();
        if (pending) return;
        setPending(true);
        void downloadApiFile(href)
          .then(() => onDownloaded?.())
          .catch((error: unknown) => toast.error(error instanceof Error ? error.message : t("Download failed.")))
          .finally(() => setPending(false));
      }}
    />
  );
}
