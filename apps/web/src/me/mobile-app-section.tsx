import { Skeleton } from "@crowhr/ui";
import { useQuery } from "@tanstack/react-query";
import { Info } from "lucide-react";
import { useMe } from "../auth/session.ts";
import { CopyField } from "../components/copy-field.tsx";
import { Section } from "../components/section.tsx";
import { AppStoreLinks } from "./app-store-links.tsx";
import { connectQrDataUrl, isHttps, mobileConnectPayload } from "./mobile-connect.ts";

/**
 * My profile → Mobile app (add-mobile-apps task 1.1). The QR code tells the Crow HR app which
 * server and organisation to connect to; it holds no credentials, so it is safe to show on screen
 * or print. The Android app is on Google Play; the iPhone and iPad app is still in App Store review, so its
 * entry says "coming soon" (app-stores.ts).
 */

export function MobileAppSection() {
  const me = useMe();
  const slug = me.organisation.slug ?? "";
  const payload = mobileConnectPayload(me.publicUrl, slug);
  const qr = useQuery({
    queryKey: ["mobile-connect-qr", payload],
    queryFn: () => connectQrDataUrl(payload),
    staleTime: Number.POSITIVE_INFINITY,
    enabled: !me.demoMode,
  });
  return (
    <Section
      id="mobile-app"
      title="Mobile app"
      description="Use Crow HR on your phone for payslips, leave, claims, clock-in and approvals. The app connects only to your company's own Crow HR server."
    >
      {me.demoMode ? (
        <p className="flex items-start gap-2 p-4 text-ui text-primary-300">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
          The public demo runs in your browser, so there is no server for the mobile app to connect to. On your
          company's own Crow HR, this is where the connection code appears.
        </p>
      ) : (
        <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-start">
          <div className="size-[184px] shrink-0 self-center rounded-md border border-border bg-white p-1 sm:self-start">
            {qr.data ? (
              <img
                src={qr.data}
                width={176}
                height={176}
                alt={`QR code that connects the Crow HR app to ${me.organisation.name}`}
              />
            ) : qr.isError ? (
              <p className="p-3 text-2xs text-danger-300" role="alert">
                Couldn't draw the code. Enter the server address in the app instead.
              </p>
            ) : (
              <Skeleton className="size-full" />
            )}
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-3">
            <ol className="list-decimal pl-4 text-ui text-primary-300">
              <li>Install the Crow HR app on your phone.</li>
              <li>Scan this code with the Crow HR app, or choose "Enter server address" and type the address below.</li>
              <li>Confirm the organisation name, then sign in the way you sign in here.</li>
            </ol>
            <div className="flex flex-col gap-1">
              <span className="font-azeret text-2xs font-semibold uppercase tracking-wider text-primary-300">
                Server address
              </span>
              <CopyField value={me.publicUrl} label="Server address" />
              <p className="text-2xs text-primary-300">
                Organisation:{" "}
                <span className="num text-ink" data-testid="org-slug">
                  {slug}
                </span>
              </p>
            </div>
            {isHttps(me.publicUrl) ? null : (
              <p className="flex items-start gap-2 text-2xs text-primary-300" data-testid="http-note">
                <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                This server uses plain HTTP, so the connection is not encrypted. The app connects over HTTP only to a
                private network address or a .local name, after a warning. Ask your administrator to set up HTTPS.
              </p>
            )}
            <p className="text-2xs text-primary-300">
              The code holds only the server address and organisation, never your password or a sign-in.
            </p>
            <AppStoreLinks />
          </div>
        </div>
      )}
    </Section>
  );
}
