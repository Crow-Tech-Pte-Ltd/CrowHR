/**
 * The in-process mock OpenID provider (packages/core/testing/mock-oidc.ts) served over plain HTTP
 * on 127.0.0.1 for e2e only (started by playwright.config.ts), so the real server and the browser
 * can do a full generic-OIDC round trip with no external service. There is no login page: the
 * authorize endpoint signs in whoever was set with `POST /_control/next-user` and redirects back.
 * DEV/TEST ONLY: it signs any identity it is told to.
 */
import { createServer } from "node:http";
import { createMockIdp, type MockLogin } from "../packages/core/testing/mock-oidc.ts";
import { MOCK_IDP } from "./fixtures.ts";

const idp = await createMockIdp({
  issuer: MOCK_IDP.issuer,
  clientId: MOCK_IDP.clientId,
  clientSecret: MOCK_IDP.clientSecret,
});

const server = createServer(async (req, res) => {
  try {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const body = Buffer.concat(chunks);
    const url = new URL(req.url ?? "/", MOCK_IDP.origin);
    if (req.method === "POST" && url.pathname === "/_control/next-user") {
      idp.nextUser = JSON.parse(body.toString("utf8")) as MockLogin;
      res.writeHead(204).end();
      return;
    }
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers.set(k, v);
    const response = await idp.app.request(url.toString(), {
      method: req.method,
      headers,
      ...(req.method === "GET" || req.method === "HEAD" ? {} : { body }),
    });
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (err) {
    res.writeHead(500, { "content-type": "text/plain" }).end(String(err));
  }
});

server.listen(Number(new URL(MOCK_IDP.origin).port), "127.0.0.1");
