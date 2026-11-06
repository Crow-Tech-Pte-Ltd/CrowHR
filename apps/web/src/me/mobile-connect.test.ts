import { describe, expect, it } from "vitest";
import { connectQrDataUrl, isHttps, mobileConnectPayload } from "./mobile-connect.ts";

describe("mobile app connect payload", () => {
  it("encodes only the server address and the organisation slug", () => {
    const payload = mobileConnectPayload("https://hr.kampongkopi.sg/", "kampong-kopi");
    expect(payload).toBe("crowhr://connect?server=https%3A%2F%2Fhr.kampongkopi.sg&org=kampong-kopi");
    const url = new URL(payload);
    expect(url.protocol).toBe("crowhr:");
    expect([...url.searchParams.keys()]).toEqual(["server", "org"]);
    expect(url.searchParams.get("server")).toBe("https://hr.kampongkopi.sg");
  });

  it("knows when the app will warn about plain HTTP", () => {
    expect(isHttps("https://hr.example.sg")).toBe(true);
    expect(isHttps("http://192.168.1.20:8080")).toBe(false);
  });

  it("renders the QR code locally as an SVG data URL", async () => {
    const a = await connectQrDataUrl(mobileConnectPayload("https://hr.example.sg", "a-co"));
    const b = await connectQrDataUrl(mobileConnectPayload("https://hr.example.sg", "b-co"));
    expect(a).toMatch(/^data:image\/svg\+xml;charset=utf-8,%3Csvg/);
    expect(a).not.toBe(b);
  });
});
