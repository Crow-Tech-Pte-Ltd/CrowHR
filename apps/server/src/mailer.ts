import type { Mailer } from "@crowhr/core";
import nodemailer from "nodemailer";

/**
 * SMTP mailer (workflows "Email notifications"). Optional: without SMTP_URL, Crow HR works with
 * in-app notifications only, and invitations and resets offer a copyable link.
 *
 *   SMTP_URL   smtp://user:pass@host:587 (STARTTLS when offered) or smtps://user:pass@host:465
 *   MAIL_FROM  "Crow HR <hr@example.sg>" (required when SMTP_URL is set)
 *
 * Core never sends directly for notifications: it queues to the outbox and the scheduled sweep
 * calls `send`, retrying on failure.
 */
export class MailerConfigError extends Error {
  override name = "MailerConfigError";
}

export interface SmtpConfig {
  url: string;
  from: string;
  /** Connection and greeting timeout; default 15 s. */
  timeoutMs?: number;
}

export function mailerConfigFromEnv(env: Record<string, string | undefined>): SmtpConfig | null {
  const url = env.SMTP_URL?.trim();
  const from = env.MAIL_FROM?.trim();
  if (!url) {
    if (from) throw new MailerConfigError("MAIL_FROM is set but SMTP_URL is not. Set SMTP_URL, or remove MAIL_FROM.");
    return null;
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new MailerConfigError(
      "SMTP_URL is not a valid URL. Use smtp://user:password@smtp.example.sg:587 or smtps://user:password@smtp.example.sg:465 (URL-encode special characters in the password).",
    );
  }
  if (parsed.protocol !== "smtp:" && parsed.protocol !== "smtps:") {
    throw new MailerConfigError(`SMTP_URL must start with smtp:// or smtps://, not ${parsed.protocol}//.`);
  }
  if (!from) {
    throw new MailerConfigError('MAIL_FROM is required with SMTP_URL, e.g. MAIL_FROM="Crow HR <hr@example.sg>".');
  }
  if (!/@[^@\s>]+\.[^@\s>]+>?$/.test(from)) {
    throw new MailerConfigError('MAIL_FROM must contain an email address, e.g. "Crow HR <hr@example.sg>".');
  }
  return { url, from };
}

export function createSmtpMailer(config: SmtpConfig): Mailer & { close(): void } {
  const timeout = config.timeoutMs ?? 15_000;
  const url = new URL(config.url);
  const secure = url.protocol === "smtps:";
  const transport = nodemailer.createTransport({
    host: url.hostname,
    port: url.port ? Number(url.port) : secure ? 465 : 587,
    secure,
    ...(url.username
      ? { auth: { user: decodeURIComponent(url.username), pass: decodeURIComponent(url.password) } }
      : {}),
    connectionTimeout: timeout,
    greetingTimeout: timeout,
    socketTimeout: timeout * 2,
  });
  return {
    async send(message) {
      await transport.sendMail({
        from: config.from,
        to: message.to,
        subject: message.subject,
        text: message.text,
        ...(message.html ? { html: message.html } : {}),
      });
    },
    close: () => transport.close(),
  };
}

/** The mailer for this environment, or undefined when SMTP is not configured. */
export function mailerFromEnv(env: Record<string, string | undefined>): (Mailer & { close(): void }) | undefined {
  const config = mailerConfigFromEnv(env);
  return config ? createSmtpMailer(config) : undefined;
}
