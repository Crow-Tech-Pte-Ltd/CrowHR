import * as React from "react";

/** The theme choice: "system" (the default) follows the device; light or dark is kept in this browser. */
export type ThemePreference = "system" | "light" | "dark";

/** localStorage key, shared with /theme.js, which applies the theme before the first paint. */
export const THEME_KEY = "crowhr.theme";

const DARK_QUERY = "(prefers-color-scheme: dark)";
// The browser chrome's colour (address bar on phones): the page background of each theme.
const THEME_COLOR = { light: "#FFFFFF", dark: "#141414" } as const;

export function readThemePreference(): ThemePreference {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

/** Light or dark for a preference, given whether the device prefers dark. */
export function resolveTheme(pref: ThemePreference, deviceDark: boolean): "light" | "dark" {
  return pref === "system" ? (deviceDark ? "dark" : "light") : pref;
}

function deviceDark(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia?.(DARK_QUERY).matches;
}

export function applyTheme(pref: ThemePreference): void {
  const theme = resolveTheme(pref, deviceDark());
  const root = document.documentElement;
  root.classList.toggle("dark", theme === "dark");
  root.style.colorScheme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEME_COLOR[theme]);
}

const listeners = new Set<() => void>();

export function setThemePreference(pref: ThemePreference): void {
  try {
    if (pref === "system") localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, pref);
  } catch {
    // Storage blocked (some private modes): the choice lasts until the page is reloaded.
  }
  current = pref;
  applyTheme(pref);
  for (const l of listeners) l();
}

let current: ThemePreference | null = null;

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  // "System" follows the device live, e.g. when it switches to dark at sunset.
  const media = window.matchMedia?.(DARK_QUERY);
  const onChange = () => {
    if ((current ?? readThemePreference()) === "system") applyTheme("system");
    listener();
  };
  media?.addEventListener("change", onChange);
  // Another tab of this app changed the choice.
  const onStorage = (e: StorageEvent) => {
    if (e.key !== THEME_KEY && e.key !== null) return;
    current = readThemePreference();
    applyTheme(current);
    listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    media?.removeEventListener("change", onChange);
    window.removeEventListener("storage", onStorage);
  };
}

/** The theme choice and a setter, for the account menu. */
export function useThemePreference(): [ThemePreference, (pref: ThemePreference) => void] {
  const pref = React.useSyncExternalStore(
    subscribe,
    () => current ?? readThemePreference(),
    () => "system" as const,
  );
  return [pref, setThemePreference];
}
