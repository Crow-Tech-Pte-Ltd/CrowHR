import { createContext, useContext } from "react";

type Values = Record<string, string | number>;

interface UiLocale {
  locale: string;
  t: (message: string, values?: Values) => string;
}

const LocaleContext = createContext<UiLocale>({
  locale: "en-SG",
  t: (message, values) =>
    message.replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/g, (placeholder, key: string) => String(values?.[key] ?? placeholder)),
});

export const UiLocaleProvider = LocaleContext.Provider;

export function useUiLocale() {
  return useContext(LocaleContext);
}
