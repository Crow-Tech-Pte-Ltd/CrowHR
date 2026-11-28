import { useCallback, useSyncExternalStore } from "react";

export const LANGUAGES = {
  "en-SG": "English",
  "zh-SG": "简体中文",
  "ms-SG": "Bahasa Melayu",
  "ta-SG": "தமிழ்",
} as const;

export type Locale = keyof typeof LANGUAGES;
export type MessageValues = Record<string, string | number>;
export type Translate = (message: string, values?: MessageValues) => string;

const DEFAULT_LOCALE = "en-SG";
export const LOCALE_STORAGE_KEY = "crowhr.locale";
const listeners = new Set<() => void>();
type Catalogs = Record<string, Record<string, string>>;
const packs = new Map<Locale, Catalogs>();
const loading = new Map<Locale, Promise<void>>();
const loadPack = {
  "zh-SG": () => import("./packs/zh-SG.ts"),
  "ms-SG": () => import("./packs/ms-SG.ts"),
  "ta-SG": () => import("./packs/ta-SG.ts"),
};

export function loadLocale(locale: Locale): Promise<void> {
  if (locale === DEFAULT_LOCALE || packs.has(locale)) return Promise.resolve();
  const pending = loading.get(locale);
  if (pending) return pending;
  const load = loadPack[locale]()
    .then(({ messages }) => {
      packs.set(locale, messages);
    })
    .finally(() => loading.delete(locale));
  loading.set(locale, load);
  return load;
}

function isLocale(value: string | null): value is Locale {
  return value !== null && Object.hasOwn(LANGUAGES, value);
}

export function preferredLocale(languages: readonly string[]): Locale {
  for (const tag of languages) {
    switch (tag.toLowerCase().split("-")[0]) {
      case "en":
        return "en-SG";
      case "zh":
        return "zh-SG";
      case "ms":
        return "ms-SG";
      case "ta":
        return "ta-SG";
    }
  }
  return DEFAULT_LOCALE;
}

function initialLocale(): Locale {
  try {
    const value = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    if (isLocale(value)) return value;
  } catch {
    // The interface still works when storage is disabled.
  }
  return preferredLocale(window.navigator.languages);
}

let activeLocale: Locale = DEFAULT_LOCALE;
let localeRequest = 0;

export function getLocale(): Locale {
  return activeLocale;
}

function applyLocale(locale: Locale) {
  activeLocale = locale;
  if (typeof document !== "undefined") document.documentElement.lang = locale;
  for (const notify of listeners) notify();
}

async function changeLocale(locale: Locale, persist: boolean): Promise<boolean> {
  const request = ++localeRequest;
  try {
    await loadLocale(locale);
  } catch {
    return false;
  }
  if (request !== localeRequest) return true;
  if (persist) {
    try {
      window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
    } catch {
      // Allow a language change for the current visit.
    }
  }
  if (locale !== activeLocale) applyLocale(locale);
  return true;
}

export function setLocale(locale: Locale): Promise<boolean> {
  return changeLocale(locale, true);
}

export const localeReady = typeof window === "undefined" ? Promise.resolve() : changeLocale(initialLocale(), false);

if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key === LOCALE_STORAGE_KEY || event.key === null) {
      void changeLocale(initialLocale(), false);
    }
  });
}

function subscribe(notify: () => void) {
  listeners.add(notify);
  return () => listeners.delete(notify);
}

export function useLocale(): Locale {
  return useSyncExternalStore(subscribe, getLocale, () => DEFAULT_LOCALE);
}

export function translate(locale: Locale, scope: string, message: string, values?: MessageValues): string {
  const catalog = packs.get(locale)?.[`../catalogs/${scope}.${locale}.json`];
  const template = catalog && Object.hasOwn(catalog, message) ? (catalog[message] ?? message) : message;
  return template.replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/g, (placeholder, key: string) => {
    return values && Object.hasOwn(values, key) ? String(values[key]) : placeholder;
  });
}

export function useT(scope: string): Translate {
  const locale = useLocale();
  return useCallback((message, values) => translate(locale, scope, message, values), [locale, scope]);
}
