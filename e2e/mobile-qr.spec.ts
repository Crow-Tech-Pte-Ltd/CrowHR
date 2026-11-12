import { expect, test } from "@playwright/test";
import { connectQrDataUrl, mobileConnectPayload } from "../apps/web/src/me/mobile-connect.ts";
import { E2E, uiSignInOk } from "./fixtures.ts";

/**
 * add-mobile-apps task 1.1: My profile → Mobile app shows a QR code for the native apps that
 * encodes `crowhr://connect?server=<PUBLIC_URL>&org=<slug>` and nothing that could sign anyone in.
 * The QR image is compared with the same deterministic encoder run on the expected payload, so the
 * test proves what the code holds, not just what the page says.
 */
test.describe("My profile → Mobile app", () => {
  test("QR code holds only the server address and organisation; Google Play is linked, the App Store is coming soon", async ({
    page,
    baseURL,
  }) => {
    // An employee with a linked record, and (next test) an owner without one: both see the section.
    await uiSignInOk(page, E2E.members.requester.email);
    await page.goto("/me/profile");
    const section = page.getByRole("region", { name: "Mobile app" });
    await expect(section).toBeVisible();
    await expect(section).toContainText("Scan this code with the Crow HR app");

    const expected = mobileConnectPayload(baseURL as string, E2E.org.slug);
    expect(expected).toBe(`crowhr://connect?server=${encodeURIComponent(baseURL as string)}&org=${E2E.org.slug}`);
    const qr = section.getByRole("img", { name: /QR code/ });
    await expect(qr).toHaveAttribute("src", await connectQrDataUrl(expected));

    // No credentials: no cookie value, email or token-like parameter in what the QR holds.
    const payload = new URL(expected);
    expect([...payload.searchParams.keys()]).toEqual(["server", "org"]);
    for (const cookie of await page.context().cookies()) expect(expected).not.toContain(cookie.value);
    expect(expected).not.toContain(E2E.members.requester.email);

    // The server address in mono, with a copy button.
    const server = section.getByRole("textbox", { name: "Server address" });
    await expect(server).toHaveValue(baseURL as string);
    await expect(server).toHaveClass(/num/);
    await expect(section.getByRole("button", { name: "Copy Server address" })).toBeVisible();
    await expect(section.getByTestId("org-slug")).toHaveText(E2E.org.slug);

    // The e2e server runs on plain http: the page says what the app will do.
    await expect(section.getByTestId("http-note")).toContainText("not encrypted");

    // Android is on Google Play; the iPhone app is still in App Store review.
    await expect(section.getByRole("link", { name: /Get it on Google Play/ })).toHaveAttribute(
      "href",
      "https://play.google.com/store/apps/details?id=crowtech.crowhr",
    );
    await expect(section.getByText("App Store: coming soon")).toBeVisible();
    await expect(section.getByRole("link", { name: /App Store/ })).toHaveCount(0);
  });

  test("members without an employee record get the section too, at 360px", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 780 });
    await uiSignInOk(page, E2E.members.owner.email);
    await page.goto("/me/profile");
    await expect(page.getByText("No employee record linked")).toBeVisible();
    const section = page.getByRole("region", { name: "Mobile app" });
    await expect(section.getByRole("img", { name: /QR code/ })).toBeVisible();
    // No horizontal scroll at phone width.
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
});
