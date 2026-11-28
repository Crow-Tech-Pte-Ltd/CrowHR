import "@crowhr/ui/styles.css";
import { Button, textStyle } from "@crowhr/ui";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { LANGUAGES, type Locale, setLocale, useLocale, useT } from "../../web/src/i18n/index.ts";
import { useThemePreference } from "../../web/src/shell/theme.ts";

export function waitForDemoStart(element: HTMLElement): Promise<void> {
  const root = createRoot(element);
  return new Promise<void>((resolve) => {
    root.render(<DemoEntry onStart={resolve} />);
  }).then(() => root.unmount());
}

function DemoEntry({ onStart }: { onStart: () => void }) {
  useThemePreference(); // Follow system theme changes before the app shell mounts.
  const locale = useLocale();
  const t = useT("demo");
  const common = useT("common");
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  async function choose(value: Locale) {
    setPending(true);
    setFailed(false);
    setFailed(!(await setLocale(value)));
    setPending(false);
  }

  return (
    <main className="grid min-h-dvh place-items-center bg-surface-100 px-4 py-6" data-testid="demo-entry">
      <div className="w-full max-w-[420px] rounded-lg border-2 border-ink bg-surface-50 p-5 shadow-brutal sm:p-6">
        <h1 className="text-xl font-semibold">{t("Try Crow HR")}</h1>
        <p className="mb-5 mt-2 text-ui leading-5 text-primary-300">
          {t("Explore a fictional company. Changes stay in this browser.")}
        </p>
        <fieldset disabled={pending} aria-busy={pending} className="mb-5">
          <legend className={textStyle.group}>{common("Language")}</legend>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {Object.entries(LANGUAGES).map(([value, label]) => (
              <label
                key={value}
                className="flex min-h-10 cursor-pointer items-center gap-2 rounded-md border border-input px-2 text-ui has-[:checked]:border-ink"
              >
                <input
                  type="radio"
                  name="demo-language"
                  checked={locale === value}
                  className="focus-ring size-4 shrink-0 accent-ink"
                  onChange={() => void choose(value as Locale)}
                />
                <span lang={value}>{label}</span>
              </label>
            ))}
          </div>
          {failed ? (
            <p role="alert" className="mt-2 text-ui text-danger-300">
              {common("Couldn't load that language. Try again.")}
            </p>
          ) : null}
        </fieldset>
        <Button type="button" variant="primary" onClick={onStart} disabled={pending} data-testid="demo-start">
          {t("Start demo")}
        </Button>
      </div>
    </main>
  );
}
