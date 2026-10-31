import * as React from "react";

/**
 * NOT IMPLEMENTED: real roles come from the auth/RBAC workstream. Until then
 * the admin/employee view is a client-side preview toggle (user menu, or
 * `?view=employee` in the URL) so the employee layout can be designed.
 */
export type ViewMode = "admin" | "employee";

const KEY = "crowhr.viewMode";
const Ctx = React.createContext<{ mode: ViewMode; setMode: (m: ViewMode) => void } | null>(null);

function initialMode(): ViewMode {
  const fromUrl = new URLSearchParams(window.location.search).get("view");
  if (fromUrl === "employee" || fromUrl === "admin") return fromUrl;
  try {
    return localStorage.getItem(KEY) === "employee" ? "employee" : "admin";
  } catch {
    return "admin";
  }
}

export function ViewModeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = React.useState<ViewMode>(initialMode);
  const setMode = React.useCallback((m: ViewMode) => {
    setModeState(m);
    try {
      localStorage.setItem(KEY, m);
    } catch {
      // Storage unavailable (private mode): the toggle still works for this tab.
    }
  }, []);
  const value = React.useMemo(() => ({ mode, setMode }), [mode, setMode]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useViewMode() {
  const ctx = React.useContext(Ctx);
  if (!ctx) throw new Error("useViewMode must be used inside ViewModeProvider");
  return ctx;
}

export function usePersistentBoolean(key: string, initial: boolean): [boolean, (v: boolean) => void] {
  const [value, setValue] = React.useState(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? initial : raw === "1";
    } catch {
      return initial;
    }
  });
  const set = React.useCallback(
    (v: boolean) => {
      setValue(v);
      try {
        localStorage.setItem(key, v ? "1" : "0");
      } catch {
        // ignore
      }
    },
    [key],
  );
  return [value, set];
}
