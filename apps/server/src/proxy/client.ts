import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { ClientInfo as CoreClientInfo, Logger } from "@crowhr/core";
import type { Context } from "hono";
import { type ClientInfo, resolveClient, type TrustedProxies } from "./trust.ts";

/** What `crowhr doctor` reads to show how requests reach the app. */
export interface RequestObservation {
  at: string;
  peerIp: string | null;
  clientIp: string | null;
  scheme: "http" | "https";
  host: string | null;
  viaTrustedProxy: boolean;
  ignoredForwardedHeaders: boolean;
  forwardedFor: string | null;
  forwardedProto: string | null;
}

export function observationFile(dataDir: string): string {
  return `${dataDir}/run/last-request.json`;
}

export function readObservation(dataDir: string): RequestObservation | null {
  try {
    return JSON.parse(readFileSync(observationFile(dataDir), "utf8")) as RequestObservation;
  } catch {
    return null;
  }
}

interface NodeBindings {
  incoming?: { socket?: { remoteAddress?: string } };
}

/**
 * `AppDeps.resolveClient` for the Node server: TCP peer from the socket, forwarded headers
 * only from TRUSTED_PROXIES. Also tells the operator, once per peer per hour, when a proxy's
 * headers are being ignored, and records the latest request for `crowhr doctor`.
 */
export function createClientResolver(options: {
  trusted: TrustedProxies;
  logger: Logger;
  dataDir?: string;
  now?: () => number;
}): (c: Context) => CoreClientInfo {
  const now = options.now ?? Date.now;
  const warned = new Map<string, number>();
  let lastWrite = 0;
  // The server middleware and core's request context both ask; resolve once per request.
  const memo = new WeakMap<Request, CoreClientInfo>();
  return (c) => {
    const cached = memo.get(c.req.raw);
    if (cached) return cached;
    const peer = (c.env as NodeBindings | undefined)?.incoming?.socket?.remoteAddress ?? null;
    const info: ClientInfo = resolveClient({ peer, header: (n) => c.req.header(n) }, options.trusted);
    if (info.ignoredForwardedHeaders && info.peerIp) {
      const last = warned.get(info.peerIp) ?? 0;
      if (now() - last > 3600_000) {
        warned.set(info.peerIp, now());
        options.logger.warn(
          `Ignoring X-Forwarded-* headers from ${info.peerIp} because it is not in TRUSTED_PROXIES. If ${info.peerIp} is your reverse proxy, set TRUSTED_PROXIES=${info.peerIp} (or TRUSTED_PROXIES=private) in .env and restart.`,
          { peerIp: info.peerIp },
        );
      }
    }
    if (options.dataDir && now() - lastWrite > 5000) {
      lastWrite = now();
      const observation: RequestObservation = {
        at: new Date(now()).toISOString(),
        peerIp: info.peerIp,
        clientIp: info.ip,
        scheme: info.scheme,
        host: info.host,
        viaTrustedProxy: info.viaTrustedProxy,
        ignoredForwardedHeaders: info.ignoredForwardedHeaders,
        forwardedFor: c.req.header("x-forwarded-for") ?? null,
        forwardedProto: c.req.header("x-forwarded-proto") ?? null,
      };
      try {
        const file = observationFile(options.dataDir);
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, JSON.stringify(observation));
      } catch {
        // Diagnostics only; never fail a request over it.
      }
    }
    const result: CoreClientInfo = {
      ip: info.ip,
      peerIp: info.peerIp,
      scheme: info.scheme,
      host: info.host,
      viaTrustedProxy: info.viaTrustedProxy,
    };
    memo.set(c.req.raw, result);
    return result;
  };
}
