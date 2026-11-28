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
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  formatDate,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@crowhr/ui";
import { ChevronDown, Info, Mail, RotateCcw, Users } from "lucide-react";
import * as React from "react";
import { createRoot } from "react-dom/client";
import { LOCALE_STORAGE_KEY, useT } from "../../web/src/i18n/index.ts";
import { UiLocalisation } from "../../web/src/i18n/ui-localisation.tsx";
import { localiseBoot } from "./boot-copy.ts";
import { OPEN_OUTBOX } from "./web-extensions.tsx";

/**
 * Demo-only tools, available above the app and its sign-in page.
 */
interface BannerProps {
  client: DemoClient;
  info: DemoInfo;
  /** Discards this browser's copy; the next load restores the snapshot (main.tsx). */
  resetCopy: () => Promise<void>;
}

export function mountBanner(props: BannerProps) {
  const el = document.getElementById("demo-banner");
  if (!el) return;
  createRoot(el).render(
    <UiLocalisation>
      <DemoBanner {...props} />
    </UiLocalisation>,
  );
}

function DemoBanner({ client, info, resetCopy }: BannerProps) {
  const t = useT("demo");
  const [outboxOpen, setOutboxOpen] = React.useState(false);
  const [resetOpen, setResetOpen] = React.useState(false);
  const [resetting, setResetting] = React.useState(false);
  const menu = React.useRef<HTMLButtonElement>(null);
  const restoreFocus = (e: Event) => {
    e.preventDefault();
    menu.current?.focus();
  };

  React.useEffect(() => {
    const open = () => setOutboxOpen(true);
    window.addEventListener(OPEN_OUTBOX, open);
    return () => window.removeEventListener(OPEN_OUTBOX, open);
  }, []);

  /** Persona switcher: sign out (a normal sign-out through the API) and back to the picker. */
  const switchPersona = async () => {
    await fetch("/api/v1/auth/sign-out", { method: "POST" }).catch(() => undefined);
    location.assign("/sign-in");
  };

  const reset = async () => {
    setResetting(true);
    localiseBoot();
    const boot = document.getElementById("demo-boot");
    if (boot) boot.hidden = false;
    document.getElementById("root")?.setAttribute("hidden", "");
    try {
      await resetCopy();
      for (const key of Object.keys(localStorage)) {
        if (key.startsWith("crowhr.") && key !== LOCALE_STORAGE_KEY) localStorage.removeItem(key);
      }
    } finally {
      location.assign("/sign-in");
    }
  };

  return (
    <>
      <section
        aria-label={t("Demo")}
        data-testid="demo-banner"
        className="flex min-h-9 items-center gap-x-3 border-b border-ink/15 bg-kuning-50 px-3 py-1 md:px-5"
      >
        <nav aria-label={t("Demo controls")}>
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <Button ref={menu} variant="ghost" size="sm" data-testid="demo-options">
                {t("Demo options")}
                <ChevronDown aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="max-w-[calc(100vw-1.5rem)]">
              <DropdownMenuItem onSelect={() => void switchPersona()} data-testid="demo-switch">
                <Users aria-hidden />
                {t("Switch demo user")}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setOutboxOpen(true)} data-testid="demo-outbox">
                <Mail aria-hidden />
                {t("Test emails")}
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <a href="/about-demo" data-testid="demo-about">
                  <Info aria-hidden />
                  {t("About this demo")}
                </a>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem destructive onSelect={() => setResetOpen(true)} data-testid="demo-reset">
                <RotateCcw aria-hidden />
                {t("Reset demo")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </nav>
      </section>

      <OutboxSheet open={outboxOpen} onOpenChange={setOutboxOpen} client={client} onCloseAutoFocus={restoreFocus} />

      <AlertDialog open={resetOpen} onOpenChange={setResetOpen}>
        <AlertDialogContent onCloseAutoFocus={restoreFocus}>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("Reset the demo?")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                "This deletes everything you changed in this browser and restores the Qinghe Foods demo as it was on {date}. Other visitors are never affected: each browser has its own copy.",
                { date: formatDate(info.today) },
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={resetting}>{t("Cancel")}</AlertDialogCancel>
            <AlertDialogAction
              data-testid="demo-reset-confirm"
              disabled={resetting}
              onClick={(e) => {
                e.preventDefault();
                void reset();
              }}
            >
              {resetting ? t("Resetting…") : t("Reset demo")}
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
  onCloseAutoFocus,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  client: DemoClient;
  onCloseAutoFocus: (event: Event) => void;
}) {
  const t = useT("demo");
  const [items, setItems] = React.useState<OutboxMessage[] | null>(null);
  const [openId, setOpenId] = React.useState<number | null>(null);
  React.useEffect(() => {
    if (!open) return;
    setItems(null);
    void client.outbox().then(setItems);
  }, [open, client]);
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-[min(30rem,100vw)] p-0"
        data-testid="demo-outbox-sheet"
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <div className="border-b border-border px-4 py-3 pr-10">
          <SheetTitle className="font-azeret text-sm font-semibold">{t("Test emails")}</SheetTitle>
          <SheetDescription className="mt-1 text-ui text-primary-300">
            {t(
              "Preview invitations, password reset links and notifications generated by the demo. These emails stay in this browser.",
            )}
          </SheetDescription>
        </div>
        <div className="flex-1 overflow-y-auto">
          {items === null ? (
            <p className="p-4 text-ui text-primary-300">{t("Loading…")}</p>
          ) : items.length === 0 ? (
            <p className="p-4 text-ui text-primary-300">
              {t("No test emails yet. Request a password reset or send a demo invitation to see one here.")}
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
                      {t("To {recipient}", { recipient: m.to })} · {formatDate(sgDay(m.sentAt))}
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
