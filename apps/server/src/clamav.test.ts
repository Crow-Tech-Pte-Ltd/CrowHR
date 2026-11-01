import { createServer, type Socket } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { createClamAvScanner } from "./clamav.ts";

const closes: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of closes.splice(0)) await close();
});
async function fake(reply: string | null) {
  let received = Buffer.alloc(0);
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("data", (data) => {
      received = Buffer.concat([received, data]);
      // zINSTREAM followed by a null, length-prefixed data and a zero-length terminator.
      if (received.length >= 10 + 4 + 4 + 4 && reply !== null) socket.end(reply);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  closes.push(
    () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
  );
  return { port: (server.address() as { port: number }).port, received: () => received };
}
describe("ClamAV INSTREAM", () => {
  it.each([
    ["stream: OK\0", "clean"],
    ["stream: Eicar-Signature FOUND\0", "infected"],
    ["stream: size limit exceeded ERROR\0", "error"],
    ["unexpected\0", "error"],
  ] as const)("handles %j", async (reply, expected) => {
    const s = await fake(reply);
    const scanner = createClamAvScanner({ host: "127.0.0.1", port: s.port, timeoutMs: 1000 });
    expect(await scanner.scan(new TextEncoder().encode("test"), { fileId: "x", mime: "application/pdf" })).toBe(
      expected,
    );
    expect(s.received().subarray(0, 10).toString()).toBe("zINSTREAM\0");
    expect(s.received().readUInt32BE(10)).toBe(4);
    expect(s.received().subarray(14, 18).toString()).toBe("test");
    expect(s.received().readUInt32BE(18)).toBe(0);
  });
  it("times out without marking the file clean", async () => {
    const s = await fake(null);
    expect(
      await createClamAvScanner({ host: "127.0.0.1", port: s.port, timeoutMs: 30 }).scan(new Uint8Array(4), {
        fileId: "x",
        mime: "x",
      }),
    ).toBe("error");
  });
});
