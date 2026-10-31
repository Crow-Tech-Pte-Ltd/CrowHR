import uiPreset from "@crowhr/ui/tailwind-preset";
import type { Config } from "tailwindcss";

export default {
  presets: [uiPreset],
  content: ["./index.html", "./src/**/*.{ts,tsx}", "../web/src/**/*.{ts,tsx}", "../../packages/ui/src/**/*.{ts,tsx}"],
} satisfies Config;
