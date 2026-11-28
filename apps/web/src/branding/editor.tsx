import { Button, cn, FormField, Input, textStyle } from "@crowhr/ui";
import { useId, useState } from "react";
import { Wordmark } from "../components/wordmark.tsx";
import { useT } from "../i18n/index.ts";
import { type AppearanceDraft, Brand } from "./appearance.tsx";

export async function readPng(file: File): Promise<string> {
  if (file.size > 256 * 1024 || file.type !== "image/png") throw new Error("Choose a PNG no larger than 256 KB.");
  const image = await createImageBitmap(file).catch(() => {
    throw new Error("This PNG cannot be opened. Export the logo as PNG again.");
  });
  const fits = image.width <= 2048 && image.height <= 2048;
  image.close();
  if (!fits) throw new Error("Resize the PNG to at most 2048 × 2048 pixels.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

export function AppearanceEditor({
  value,
  onChange,
  name,
  customLogo,
  documentLogo,
  error,
  busy = false,
}: {
  value: AppearanceDraft;
  onChange: (value: AppearanceDraft) => void;
  name: string;
  customLogo?: string;
  documentLogo?: string;
  error?: string | undefined;
  busy?: boolean;
}) {
  const t = useT("settings-account");
  const [fileError, setFileError] = useState<string>();
  const [reading, setReading] = useState(false);
  const fileId = useId();
  const logoUrl = value.useDocumentLogo
    ? documentLogo
    : value.logoBase64
      ? `data:image/png;base64,${value.logoBase64}`
      : value.logoBase64 === null
        ? null
        : customLogo;
  return (
    <fieldset disabled={busy} className="flex flex-col gap-4 rounded-lg border border-border bg-surface-50 p-4">
      <legend className={cn("-ml-1 px-1", textStyle.group)}>{t("Appearance")}</legend>
      <p className="text-ui text-primary-300">
        {t("Brand the web app and sign-in page. The logo and accent are public on your company sign-in page.")}
      </p>
      <FormField label={t("Accent colour")} hint={t("Optional. Enter a hex colour like #165E85.")} error={error}>
        <Input
          placeholder="#165E85"
          value={value.accent ?? ""}
          onChange={(e) => onChange({ ...value, accent: e.target.value.trim() || null })}
          maxLength={7}
          spellCheck={false}
        />
      </FormField>
      <FormField
        label={t("App logo")}
        hint={t("Optional. PNG up to 256 KB and 2048 × 2048 pixels.")}
        error={fileError ? t(fileError) : undefined}
      >
        <Input
          id={fileId}
          type="file"
          accept="image/png"
          disabled={reading}
          onChange={async (e) => {
            const file = e.currentTarget.files?.[0];
            e.currentTarget.value = "";
            if (!file) return;
            setFileError(undefined);
            setReading(true);
            try {
              const logoBase64 = await readPng(file);
              onChange({ ...value, useDocumentLogo: false, logoBase64 });
            } catch (err) {
              setFileError(err instanceof Error ? err.message : "The logo could not be read.");
            } finally {
              setReading(false);
            }
          }}
        />
      </FormField>
      <div className="flex flex-wrap gap-2">
        {documentLogo ? (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => onChange({ ...value, useDocumentLogo: true })}
          >
            {t("Use letter logo")}
          </Button>
        ) : null}
        {logoUrl ? (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => onChange({ ...value, useDocumentLogo: false, logoBase64: null })}
          >
            {t("Remove app logo")}
          </Button>
        ) : null}
      </div>
      <div className="grid grid-cols-2 gap-2">
        {(["Light", "Dark"] as const).map((theme) => (
          <div
            key={theme}
            className={cn(
              theme === "Light" ? "appearance-preview-light" : "appearance-preview-dark",
              "flex min-w-0 flex-col gap-3 rounded-md border border-border bg-surface-50 p-3 text-ink",
            )}
          >
            <span className="text-2xs text-primary-300">{t(theme === "Light" ? "Light preview" : "Dark preview")}</span>
            <Brand name={name} appearance={{ accent: value.accent, logoUrl: logoUrl ?? null, logoSource: "none" }}>
              <Wordmark key={logoUrl} />
              <span className="self-start rounded border-2 border-ink bg-[var(--brand-action,hsl(var(--kuning-200)))] px-2 py-1 text-2xs font-semibold text-[color:var(--brand-action-text,hsl(var(--accent-foreground)))]">
                {t("Sign in")}
              </span>
            </Brand>
          </div>
        ))}
      </div>
    </fieldset>
  );
}
