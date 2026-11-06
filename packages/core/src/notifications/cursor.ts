import { fromBase64Url, toBase64Url, utf8 } from "../crypto/encoding.ts";
import { AppError } from "../errors.ts";

/**
 * The notifications `since` cursor (add-mobile-apps task 1.2). It names a position in a member's
 * notifications ordered by (created_at, id), so items created in the same millisecond are neither
 * skipped nor repeated. Clients treat it as opaque: base64url of `n1.<epoch ms>.<uuid>`. It grants
 * nothing; the list is always the caller's own notifications.
 */

export interface NotificationPosition {
  at: Date;
  id: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function encodeNotificationCursor(p: NotificationPosition): string {
  return toBase64Url(utf8.encode(`n1.${p.at.getTime()}.${p.id}`));
}

export function decodeNotificationCursor(cursor: string): NotificationPosition {
  const invalid = () =>
    new AppError("validation_failed", "That notifications cursor isn't valid.", {
      issues: [
        {
          path: "since",
          message: "Use the cursor from a previous notifications response, or leave since out to start again.",
        },
      ],
    });
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(fromBase64Url(cursor));
  } catch {
    throw invalid();
  }
  const [version, ms, id] = text.split(".");
  if (version !== "n1" || !ms || !/^\d{1,15}$/.test(ms) || !id || !UUID.test(id)) throw invalid();
  const at = new Date(Number(ms));
  if (Number.isNaN(at.getTime())) throw invalid();
  return { at, id };
}
