import { UiLocaleProvider } from "@crowhr/ui";
import { type ReactNode, useMemo } from "react";
import { useLocale, useT } from "./index.ts";

export function UiLocalisation({ children }: { children: ReactNode }) {
  const locale = useLocale();
  const t = useT("common");
  const value = useMemo(() => ({ locale, t }), [locale, t]);
  return <UiLocaleProvider value={value}>{children}</UiLocaleProvider>;
}
