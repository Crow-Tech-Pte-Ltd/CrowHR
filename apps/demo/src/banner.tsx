import type { DemoClient } from "@crowhr/demo/client";
import type { DemoInfo, OutboxMessage } from "@crowhr/demo/protocol";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  cn,
  formatDate,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@crowhr/ui";
import { BookOpen, Info, Mail, RotateCcw, Server, Smartphone, Users } from "lucide-react";
import * as React from "react";
import { createRoot } from "react-dom/client";
import { tryUrl } from "./try-url.ts";
import { OPEN_OUTBOX } from "./web-extensions.tsx";

/**
 * The persistent demo banner above the app: what this is, where the data lives, and the
 * demo-only controls (Outbox, About, Docs, Self-hosting, Reset). Rendered outside apps/web's
 * router so it is on every screen, including sign-in.
 */
interface BannerProps {
  client: DemoClient;
  info: DemoInfo;
  /** Fires "count" events (detail: number) when the Demo outbox receives mail. */
  outboxEvents: EventTarget;
}

export function mountBanner(props: BannerProps) {
  const el = document.getElementById("demo-banner");
  if (!el) return;
  createRoot(el).render(<DemoBanner {...props} />);
}

const linkClass =
  "focus-ring inline-flex h-7 items-center gap-1.5 rounded-sm px-1.5 font-azeret text-[11px] font-medium text-ink hover:bg-ink/[0.06]";

function DemoBanner({ client, info, outboxEvents }: BannerProps) {
  const [outboxOpen, setOutboxOpen] = React.useState(false);
  const [resetOpen, setResetOpen] = React.useState(false);
  const [count, setCount] = React.useState<number | null>(null);
  const [resetting, setResetting] = React.useState(false);
  const phoneTry = tryUrl();

  React.useEffect(() => {
    const open = () => setOutboxOpen(true);
    window.addEventListener(OPEN_OUTBOX, open);
    const onCount = (e: Event) => setCount((e as CustomEvent<number>).detail);
    outboxEvents.addEventListener("count", onCount);
    void client.outbox().then((m) => setCount(m.length));
    return () => {
      window.removeEventListener(OPEN_OUTBOX, open);
      outboxEvents.removeEventListener("count", onCount);
    };
  }, [client, outboxEvents]);

  /** Persona switcher: sign out (a normal sign-out through the API) and back to the picker. */
  const switchPersona = async () => {
    await fetch("/api/v1/auth/sign-out", { method: "POST" }).catch(() => undefined);
    location.assign("/sign-in");
  };

  const reset = async () => {
    setResetting(true);
    const boot = document.getElementById("demo-boot");
    if (boot) boot.hidden = false;
    document.getElementById("root")?.setAttribute("hidden", "");
    try {
      await client.reset();
      for (const key of Object.keys(localStorage)) if (key.startsWith("crowhr.")) localStorage.removeItem(key);
    } finally {
      location.assign("/sign-in");
    }
  };

  return (
    <>
      <section
        aria-label="Demo"
        data-testid="demo-banner"
        className="flex min-h-9 items-center gap-x-3 border-b border-ink/15 bg-kuning-50 px-3 py-1 md:px-5"
      >
        <span className="rounded-[4px] border-2 border-ink bg-kuning-200 px-1 py-px font-azeret text-[10px] font-bold leading-none tracking-wider">
          DEMO
        </span>
        <p className="min-w-0 flex-1 truncate text-2xs leading-4 text-primary-300">
          <span className="sm:hidden">Runs in your browser</span>
          <span className="hidden sm:inline">
            Demo — runs entirely in your browser. Nothing you enter leaves this device.
          </span>
        </p>
        <nav aria-label="Demo controls" className="-mr-1.5 flex shrink-0 items-center">
          <button type="button" className={linkClass} onClick={() => setOutboxOpen(true)} data-testid="demo-outbox">
            <Mail className="size-3.5" aria-hidden />
            <span className="sr-only sm:not-sr-only">Outbox</span>
            {count ? <span className="num">{count}</span> : null}
          </button>
          <button type="button" className={linkClass} onClick={() => void switchPersona()} data-testid="demo-switch">
            <Users className="size-3.5" aria-hidden />
            <span className="sr-only sm:not-sr-only">Switch persona</span>
          </button>
          {phoneTry ? (
            <a className={linkClass} href={phoneTry} data-testid="demo-try-phone">
              <Smartphone className="size-3.5" aria-hidden />
              <span className="sr-only lg:not-sr-only">Try it on your phone</span>
            </a>
          ) : null}
          <a className={linkClass} href="/about-demo" data-testid="demo-about">
            <Info className="size-3.5" aria-hidden />
            <span className="hidden md:inline">About this demo</span>
            <span className="sr-only sm:not-sr-only md:hidden">About</span>
          </a>
          <a className={cn(linkClass, "hidden sm:inline-flex")} href="/docs/">
            <BookOpen className="size-3.5" aria-hidden />
            Docs
          </a>
          <a className={cn(linkClass, "hidden sm:inline-flex")} href="/docs/self-hosting/install/">
            <Server className="size-3.5" aria-hidden />
            Self-host
          </a>
          <button type="button" className={linkClass} onClick={() => setResetOpen(true)} data-testid="demo-reset">
            <RotateCcw className="size-3.5" aria-hidden />
            <span className="sr-only sm:not-sr-only">Reset</span>
          </button>
        </nav>
      </section>

      <OutboxSheet open={outboxOpen} onOpenChange={setOutboxOpen} client={client} />

      <AlertDialog open={resetOpen} onOpenChange={setResetOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset the demo?</AlertDialogTitle>
            <AlertDialogDescription>
              This deletes everything you changed in this browser and loads Kopi Kaki's data fresh, as it was on{" "}
              {formatDate(info.today)}. Other visitors are never affected: each browser has its own copy.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={resetting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              data-testid="demo-reset-confirm"
              disabled={resetting}
              onClick={(e) => {
                e.preventDefault();
                void reset();
              }}
            >
              {resetting ? "Resetting…" : "Reset demo"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

const URL_RE = /(https?:\/\/[^\s<>"')]+)/g;

function Linkified({ text }: { text: string }) {
  const parts = text.split(URL_RE);
  return (
    <>
      {parts.map((part, i) =>
        /^https?:\/\//.test(part) ? (
          // Same-origin links (invitations, password resets) open in the demo; nothing else exists here.
          // biome-ignore lint/suspicious/noArrayIndexKey: static split of one message.
          <a key={i} href={part} className="break-all text-biru-400 underline underline-offset-2">
            {part.replace(location.origin, "")}
          </a>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: static split of one message.
          <React.Fragment key={i}>{part}</React.Fragment>
        ),
      )}
    </>
  );
}

function OutboxSheet({
  open,
  onOpenChange,
  client,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  client: DemoClient;
}) {
  const [items, setItems] = React.useState<OutboxMessage[] | null>(null);
  const [openId, setOpenId] = React.useState<number | null>(null);
  React.useEffect(() => {
    if (!open) return;
    setItems(null);
    void client.outbox().then(setItems);
  }, [open, client]);
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[min(30rem,100vw)] p-0" data-testid="demo-outbox-sheet">
        <div className="border-b border-border px-4 py-3 pr-10">
          <SheetTitle className="font-azeret text-sm font-semibold">Demo outbox</SheetTitle>
          <SheetDescription className="mt-1 text-ui text-primary-300">
            The demo sends no email. Everything Crow HR would have emailed lands here instead, so invitation and
            password-reset links still work.
          </SheetDescription>
        </div>
        <div className="flex-1 overflow-y-auto">
          {items === null ? (
            <p className="p-4 text-ui text-primary-300">Loading…</p>
          ) : items.length === 0 ? (
            <p className="p-4 text-ui text-primary-300">
              Nothing yet. Invite someone in Settings → Members, or use “Forgot password?” on the sign-in page.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {items.map((m) => (
                <li key={m.id}>
                  <button
                    type="button"
                    className="focus-ring flex w-full flex-col gap-0.5 px-4 py-2.5 text-left hover:bg-ink/[0.03]"
                    aria-expanded={openId === m.id}
                    onClick={() => setOpenId(openId === m.id ? null : m.id)}
                  >
                    <span className="text-ui font-medium leading-5">{m.subject}</span>
                    <span className="num text-2xs text-primary-200">
                      To {m.to} · {formatDate(sgDay(m.sentAt))}
                    </span>
                  </button>
                  {openId === m.id ? (
                    <div className="whitespace-pre-wrap break-words bg-surface-100/50 px-4 pb-3 pt-1 text-ui leading-5">
                      <Linkified text={m.text} />
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function sgDay(iso: string): string {
  return new Date(new Date(iso).getTime() + 8 * 3600_000).toISOString().slice(0, 10);
}
