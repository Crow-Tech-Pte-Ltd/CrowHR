import { connect } from "node:net";
import type { FileScanner } from "../../../packages/core/src/files/scanner.ts";

/** clamd INSTREAM over a private TCP connection. No filesystem paths or shell commands are sent. */
export function createClamAvScanner(options: { host: string; port: number; timeoutMs?: number }): FileScanner {
  return {
    scan(data) {
      return new Promise((resolve) => {
        const socket = connect({ host: options.host, port: options.port });
        let reply = "";
        let finished = false;
        const finish = (verdict: "clean" | "infected" | "error") => {
          if (finished) return;
          finished = true;
          clearTimeout(deadline);
          socket.destroy();
          resolve(verdict);
        };
        // Absolute deadline, including connect, write and response (a trickle cannot keep it alive).
        const deadline = setTimeout(() => finish("error"), options.timeoutMs ?? 15_000);
        socket.on("error", () => finish("error"));
        socket.on("end", () => finish("error"));
        socket.on("data", (chunk) => {
          reply += chunk.toString("utf8");
          if (reply.length > 4096) return finish("error");
          if (!/[\0\n]/.test(reply)) return;
          const line = reply.split(/[\0\r\n]/)[0];
          finish(line === "stream: OK" ? "clean" : /^stream: .+ FOUND$/.test(line ?? "") ? "infected" : "error");
        });
        socket.on("connect", async () => {
          const write = (bytes: Uint8Array | string) =>
            new Promise<void>((done, reject) => socket.write(bytes, (err) => (err ? reject(err) : done())));
          try {
            await write("zINSTREAM\0");
            for (let at = 0; at < data.length && !finished; at += 64 * 1024) {
              const chunk = data.subarray(at, at + 64 * 1024);
              const length = Buffer.alloc(4);
              length.writeUInt32BE(chunk.length);
              await write(length);
              await write(chunk);
            }
            if (!finished) await write(Buffer.alloc(4));
          } catch {
            finish("error");
          }
        });
      });
    },
  };
}
