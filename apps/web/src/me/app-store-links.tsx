import { cn } from "@crowhr/ui";
import { ExternalLink, Smartphone } from "lucide-react";
import { APP_STORE_URL, GOOGLE_PLAY_URL } from "./app-stores.ts";

const LINK =
  "focus-ring inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 font-azeret text-2xs text-biru-400 underline-offset-2 hover:underline";

const STORES = [
  { href: GOOGLE_PLAY_URL, label: "Get it on Google Play" },
  { href: APP_STORE_URL, label: "Download on the App Store" },
];

/** Links to the Crow HR app on Google Play and the App Store. */
export function AppStoreLinks({ className }: { className?: string }) {
  return (
    <ul className={cn("flex flex-wrap gap-2", className)} aria-label="App stores">
      {STORES.map((store) => (
        <li key={store.href}>
          <a href={store.href} target="_blank" rel="noreferrer" className={LINK}>
            <Smartphone className="size-3.5" aria-hidden />
            {store.label}
            <ExternalLink className="size-3" aria-hidden />
            <span className="sr-only">(opens in a new tab)</span>
          </a>
        </li>
      ))}
    </ul>
  );
}
