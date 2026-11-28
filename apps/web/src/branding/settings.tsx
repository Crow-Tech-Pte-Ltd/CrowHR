import { Button, toast } from "@crowhr/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { meQuery, useMe } from "../auth/session.ts";
import { useT } from "../i18n/index.ts";
import { apiPut } from "../lib/api.ts";
import { type Appearance, type AppearanceDraft, stockAppearance } from "./appearance.tsx";
import { AppearanceEditor } from "./editor.tsx";

export function AppearanceSettings({ documentLogo }: { documentLogo?: string }) {
  const t = useT("settings-account");
  const me = useMe();
  const appearance = me.appearance ?? stockAppearance;
  const [draft, setDraft] = useState<AppearanceDraft>();
  const [error, setError] = useState<string>();
  const value = draft ?? { accent: appearance.accent, useDocumentLogo: appearance.logoSource === "document" };
  const qc = useQueryClient();
  const save = useMutation({
    mutationFn: (input: AppearanceDraft) => apiPut<Appearance>("/api/v1/organisation/appearance", input),
    onSuccess: (appearance) => {
      qc.setQueryData(meQuery.queryKey, (current) => (current ? { ...current, appearance } : current));
      setDraft(undefined);
      setError(undefined);
      toast(t("Appearance saved"));
    },
    onError: (err) => setError(err instanceof Error ? err.message : t("Appearance could not be saved.")),
  });
  return (
    <form
      className="mt-6 flex max-w-xl flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (value.accent && !/^#[\da-f]{6}$/i.test(value.accent))
          return setError(t("Enter a hex colour like #165E85."));
        save.mutate(value);
      }}
    >
      <AppearanceEditor
        value={value}
        onChange={(next) => {
          setDraft(next);
          setError(undefined);
        }}
        name={me.organisation.name}
        {...(appearance.logoSource === "custom" && appearance.logoUrl ? { customLogo: appearance.logoUrl } : {})}
        {...(documentLogo ? { documentLogo } : {})}
        busy={save.isPending}
      />
      {error ? (
        <p role="alert" className="text-ui text-danger-300">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="primary" disabled={!draft || save.isPending}>
          {save.isPending ? t("Saving…") : t("Save appearance")}
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={save.isPending || (!draft && !appearance.accent && appearance.logoSource === "none")}
          onClick={() => save.mutate({ accent: null, logoBase64: null, useDocumentLogo: false })}
        >
          {t("Reset appearance")}
        </Button>
      </div>
    </form>
  );
}
