import * as React from "react";

/**
 * Which layout the shell shows. Members with only the employee role always get the employee layout
 * (bottom tab bar on phones, the employee Home). Owners, admins and managers get the admin layout
 * and can preview the employee one from the user menu (or `?view=employee`); that choice is kept in
 * this browser. Layout only: the server enforces roles on every request either way.
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

/** True for members who approve or administer (any role besides employee). */
export function canUseAdminLayout(roles: readonly string[]): boolean {
  return roles.some((r) => r !== "employee");
}

/** The layout for a signed-in member: their chosen mode, or always "employee" when that is all they are. */
export function useLayoutMode(roles: readonly string[]) {
  const { mode, setMode } = useViewMode();
  const canSwitch = canUseAdminLayout(roles);
  return { mode: canSwitch ? mode : ("employee" as ViewMode), setMode, canSwitch };
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
