import { createServer, type Server, type Socket } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSmtpMailer, MailerConfigError, mailerConfigFromEnv, mailerFromEnv } from "./mailer.ts";

/** A minimal in-process SMTP sink: accepts one session at a time and records DATA. */
function startSink(): Promise<{ port: number; messages: string[]; server: Server; refuse: boolean }> {
  const state = { port: 0, messages: [] as string[], server: null as unknown as Server, refuse: false };
  const server = createServer((socket: Socket) => {
    if (state.refuse) {
      socket.end("554 No service\r\n");
      return;
    }
    let inData = false;
    let buffer = "";
    let data = "";
    socket.write("220 sink.test ESMTP\r\n");
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      let idx = buffer.indexOf("\r\n");
      while (idx >= 0) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        if (inData) {
          if (line === ".") {
            inData = false;
            state.messages.push(data);
            data = "";
            socket.write("250 OK queued\r\n");
          } else {
            data += `${line}\n`;
          }
        } else {
          const cmd = line.slice(0, 4).toUpperCase();
          if (cmd === "EHLO") socket.write("250-sink.test\r\n250 AUTH PLAIN LOGIN\r\n");
          else if (cmd === "HELO") socket.write("250 sink.test\r\n");
          else if (cmd === "AUTH") socket.write("235 Authentication successful\r\n");
          else if (cmd === "MAIL" || cmd === "RCPT" || cmd === "RSET" || cmd === "NOOP") socket.write("250 OK\r\n");
          else if (cmd === "DATA") {
            inData = true;
            socket.write("354 End data with <CR><LF>.<CR><LF>\r\n");
          } else if (cmd === "QUIT") socket.end("221 Bye\r\n");
          else socket.write("502 Not implemented\r\n");
        }
        idx = buffer.indexOf("\r\n");
      }
    });
  });
  state.server = server;
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      state.port = typeof address === "object" && address ? address.port : 0;
      resolve(state);
    });
  });
}

describe("SMTP mailer", () => {
  let sink: Awaited<ReturnType<typeof startSink>>;
  beforeEach(async () => {
    sink = await startSink();
  });
  afterEach(() => new Promise<void>((r) => sink.server.close(() => r())));

  it("is off without SMTP_URL, and explains bad configuration", () => {
    expect(mailerFromEnv({})).toBeUndefined();
    expect(() => mailerConfigFromEnv({ MAIL_FROM: "hr@example.sg" })).toThrow(MailerConfigError);
    expect(() => mailerConfigFromEnv({ SMTP_URL: "http://x", MAIL_FROM: "a@b.sg" })).toThrow(/smtp:\/\/ or smtps:\/\//);
    expect(() => mailerConfigFromEnv({ SMTP_URL: "smtp://mail.example.sg:587" })).toThrow(/MAIL_FROM is required/);
    expect(() => mailerConfigFromEnv({ SMTP_URL: "smtp://mail.example.sg", MAIL_FROM: "Crow HR" })).toThrow(
      /email address/,
    );
    expect(
      mailerConfigFromEnv({ SMTP_URL: "smtps://u:p@mail.example.sg:465", MAIL_FROM: "Crow HR <hr@example.sg>" }),
    ).toEqual({
      url: "smtps://u:p@mail.example.sg:465",
      from: "Crow HR <hr@example.sg>",
    });
  });

  it("delivers text and HTML parts to an SMTP server", async () => {
    const mailer = createSmtpMailer({
      url: `smtp://crowhr:s%40cret@127.0.0.1:${sink.port}`,
      from: "Crow HR <hr@kampongkopi.example>",
    });
    try {
      await mailer.send({
        to: "ravi@kampongkopi.example",
        subject: "Approval needed · Kampong Kopi Pte. Ltd.",
        text: "Ravi Kumar sent a leave request that needs your approval.",
        html: "<p>Ravi Kumar sent a leave request that needs your approval.</p>",
      });
    } finally {
      mailer.close();
    }
    expect(sink.messages).toHaveLength(1);
    const raw = sink.messages[0] as string;
    expect(raw).toMatch(/^From: Crow HR <hr@kampongkopi\.example>$/m);
    expect(raw).toMatch(/^To: ravi@kampongkopi\.example$/m);
    expect(raw).toContain("multipart/alternative");
    expect(raw).toContain("Ravi Kumar sent a leave request");
  });

  it("rejects when the server refuses, so the outbox can retry", async () => {
    sink.refuse = true;
    const mailer = createSmtpMailer({
      url: `smtp://127.0.0.1:${sink.port}`,
      from: "hr@kampongkopi.example",
      timeoutMs: 2_000,
    });
    try {
      await expect(mailer.send({ to: "x@y.sg", subject: "s", text: "t" })).rejects.toThrow();
    } finally {
      mailer.close();
    }
  });
});
