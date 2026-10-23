import { test, expect } from "@playwright/test";

const routes = [
  "/home.html",
  "/discover.html",
  "/library.html",
  "/for-you.html",
  "/search.html",
  "/account.html",
  "/watch.html"
];

test("core app routes remain navigable with the service worker active", async ({ page }) => {
  const failedNavigations = [];
  const pageErrors = [];
  page.on("requestfailed", request => {
    if (request.isNavigationRequest()) {
      failedNavigations.push({
        url: request.url(),
        error: request.failure()?.errorText || "navigation failed"
      });
    }
  });
  page.on("pageerror", error => pageErrors.push(error.message));

  const first = await page.goto("/home.html", { waitUntil: "domcontentloaded" });
  expect(first?.status()).toBe(200);
  await expect(page.locator("body")).toBeVisible();

  // Wait for service-worker installation/activation where the browser supports it.
  const workerState = await page.evaluate(async () => {
    if (!("serviceWorker" in navigator)) return "unsupported";
    const registration = await Promise.race([
      navigator.serviceWorker.ready,
      new Promise(resolve => setTimeout(() => resolve(null), 120_000))
    ]);
    return registration?.active?.state || "timeout";
  });
  expect(["activated", "unsupported"]).toContain(workerState);

  if (workerState === "activated") {
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => Boolean(navigator.serviceWorker?.controller), null, { timeout: 30_000 });
  }

  for (const route of routes) {
    const response = await page.goto(route, { waitUntil: "domcontentloaded" });
    expect(response, "navigation response missing for " + route).not.toBeNull();
    expect(response.status(), "unexpected HTTP status for " + route).toBe(200);
    expect(new URL(page.url()).pathname).toBe(route);
    await expect(page.locator("body")).toBeVisible();
  }

  expect(failedNavigations).toEqual([]);
  expect(pageErrors).toEqual([]);
});
