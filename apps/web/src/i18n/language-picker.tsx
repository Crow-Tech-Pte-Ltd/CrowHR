import { Languages } from "lucide-react";
import { useState } from "react";
import { LANGUAGES, type Locale, setLocale, useLocale, useT } from "./index.ts";

export function LanguagePicker({ className }: { className?: string }) {
  const locale = useLocale();
  const t = useT("common");
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  async function choose(value: Locale) {
    setPending(true);
    setFailed(false);
    const success = await setLocale(value);
    setFailed(!success);
    setPending(false);
  }
  return (
    <div className={className}>
      <label className="flex w-fit items-center gap-2 text-ui text-primary-300">
        <Languages aria-hidden className="size-4 shrink-0" />
        <span className="sr-only">{t("Language")}</span>
        <select
          className="focus-ring h-9 max-w-full rounded-md border border-input bg-surface-50 px-2 text-ui text-ink"
          value={locale}
          aria-busy={pending}
          onChange={(event) => void choose(event.currentTarget.value as Locale)}
        >
          {Object.entries(LANGUAGES).map(([value, label]) => (
            <option key={value} value={value} lang={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      {failed ? (
        <p role="alert" className="mt-1 max-w-56 text-2xs text-danger-300">
          {t("Couldn't load that language. Try again.")}
        </p>
      ) : null}
    </div>
  );
}
