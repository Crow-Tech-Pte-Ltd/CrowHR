import type { CSSProperties, ReactNode } from "react";
import { createContext, useContext } from "react";

export interface Appearance {
  accent: string | null;
  logoUrl: string | null;
  logoSource: "custom" | "document" | "none";
}

export interface AppearanceDraft {
  accent: string | null;
  logoBase64?: string | null;
  useDocumentLogo: boolean;
}

export const stockAppearance: Appearance = { accent: null, logoUrl: null, logoSource: "none" };
const LogoContext = createContext<{ url: string | null; name: string }>({ url: null, name: "Crow HR" });
export const useBrandLogo = () => useContext(LogoContext);

export function brandStyle(accent: string | null | undefined): CSSProperties | undefined {
  if (!accent || !/^#[\da-f]{6}$/i.test(accent)) return undefined;
  const [red = 0, green = 0, blue = 0] = [1, 3, 5].map((offset) => {
    const srgb = Number.parseInt(accent.slice(offset, offset + 2), 16) / 255;
    return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  });
  const darkText = red * 0.2126 + green * 0.7152 + blue * 0.0722 >= 0.179;
  return {
    "--brand-action": accent,
    "--brand-action-text": darkText ? "black" : "white",
    "--brand-action-hover": `color-mix(in srgb, ${accent} 88%, ${darkText ? "white" : "black"})`,
  } as CSSProperties;
}

export function Brand({ appearance, name, children }: { appearance?: Appearance; name: string; children: ReactNode }) {
  return (
    <LogoContext.Provider value={{ url: appearance?.logoUrl ?? null, name }}>
      <div className="contents" style={brandStyle(appearance?.accent)}>
        {children}
      </div>
    </LogoContext.Provider>
  );
}
