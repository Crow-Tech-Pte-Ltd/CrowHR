import QRCode from "qrcode";

/**
 * The "connect the mobile app" payload (add-mobile-apps spec "Connect to a company server"):
 * `crowhr://connect?server=<PUBLIC_URL>&org=<slug>`. It holds only the server address and the
 * organisation slug, which are public (the sign-in page shows both): never a session, token, email
 * or anything else that could sign someone in.
 */
export function mobileConnectPayload(publicUrl: string, orgSlug: string): string {
  const server = publicUrl.replace(/\/+$/, "");
  return `crowhr://connect?${new URLSearchParams({ server, org: orgSlug }).toString()}`;
}

/** True when the app may connect without a warning (HTTPS); plain HTTP is for private networks only. */
export function isHttps(publicUrl: string): boolean {
  return /^https:\/\//i.test(publicUrl);
}

/**
 * The QR code as an SVG data URL, generated in the browser by `qrcode` (MIT, the same encoder as
 * the authenticator QR): no network call, nothing leaves the page.
 */
export async function connectQrDataUrl(payload: string): Promise<string> {
  const svg = await QRCode.toString(payload, { type: "svg", margin: 2, errorCorrectionLevel: "M" });
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
