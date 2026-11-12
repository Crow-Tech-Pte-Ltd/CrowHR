import type { Config } from "tailwindcss";
import animate from "tailwindcss-animate";

/**
 * Crow Tech tokens for Tailwind 3.4, ported from crow-tech-landing
 * (tailwind.config.ts + app/globals.css). Colours resolve to CSS variables
 * defined in src/styles/globals.css and support opacity modifiers
 * (`bg-primary/10`).
 */
const hsl = (name: string) => `hsl(var(--${name}) / <alpha-value>)`;
const scale = (name: string, steps: number[]) =>
  Object.fromEntries(steps.map((s) => [s, hsl(`${name}-${s}`)])) as Record<string, string>;

const preset = {
  content: [],
  // Colours are CSS variables that `html.dark` swaps (src/styles/globals.css), so components need no
  // `dark:` variants. The class strategy lets the rare exception use one.
  darkMode: "class",
  theme: {
    extend: {
      fontFamily: {
        azeret: ['"Azeret Mono"', "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
        mono: ['"Azeret Mono"', "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
        sans: ["Ubuntu", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      fontSize: {
        // App density: 13px UI text, 11px mono labels.
        "2xs": ["0.6875rem", { lineHeight: "1rem" }],
        ui: ["0.8125rem", { lineHeight: "1.25rem" }],
      },
      colors: {
        background: hsl("background"),
        foreground: hsl("foreground"),
        card: { DEFAULT: hsl("card"), foreground: hsl("card-foreground") },
        popover: { DEFAULT: hsl("popover"), foreground: hsl("popover-foreground") },
        primary: {
          DEFAULT: hsl("primary"),
          foreground: hsl("primary-foreground"),
          ...scale("primary", [50, 100, 200, 300, 400]),
        },
        muted: { DEFAULT: hsl("muted"), foreground: hsl("muted-foreground") },
        accent: { DEFAULT: hsl("accent"), foreground: hsl("accent-foreground") },
        destructive: { DEFAULT: hsl("destructive"), foreground: hsl("destructive-foreground") },
        border: hsl("border"),
        input: hsl("input"),
        ring: hsl("ring"),
        ink: hsl("ink"),
        // Modal backdrop, alpha included: a dimming ink in light, near-black in dark.
        overlay: "hsl(var(--overlay))",
        surface: scale("surface", [50, 100, 200]),
        kuning: scale("kuning", [50, 100, 200, 300, 400]),
        biru: scale("biru", [50, 100, 200, 300, 400]),
        oren: scale("oren", [50, 100, 200, 300, 400]),
        success: scale("success", [50, 100, 200, 300, 400]),
        warning: scale("warning", [50, 100, 200, 300, 400]),
        danger: scale("danger", [50, 100, 200, 300, 400]),
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      boxShadow: {
        // The signature hard offset. Reserved for emphasis: primary button,
        // active payroll run, modal dialogs. Never blurred. --shadow is ink in
        // light and a light grey in dark, where an ink shadow would vanish.
        brutal: "4px 4px 0 0 hsl(var(--shadow))",
        "brutal-sm": "2px 2px 0 0 hsl(var(--shadow))",
        "brutal-xs": "1px 1px 0 0 hsl(var(--shadow))",
        // Floating menus: a faint hard offset to lift them off the page.
        float: "3px 3px 0 0 hsl(var(--shadow) / 0.08)",
      },
      keyframes: {
        "accordion-down": { from: { height: "0" }, to: { height: "var(--radix-accordion-content-height)" } },
        "accordion-up": { from: { height: "var(--radix-accordion-content-height)" }, to: { height: "0" } },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
      },
    },
  },
  plugins: [animate],
} satisfies Config;

export default preset;
