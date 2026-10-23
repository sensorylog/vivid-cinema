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
  page.on("requestfailed", request => {
    if (request.isNavigationRequest()) {
      failedNavigations.push({
        url: request.url(),
        error: request.failure()?.errorText || "navigation failed"
      });
    }
  });

  const first = await page.goto("/home.html", { waitUntil: "commit" });
  expect(first?.status()).toBe(200);

  expect(new URL(page.url()).origin).toBe("http://127.0.0.1:4173");

  // controllerchange intentionally reloads the first page. Poll from the Playwright
  // side so that the test survives the app's reload without holding one JS context open.
  let controlled = false;
  for (let attempt = 0; attempt < 20 && !controlled; attempt += 1) {
    await page.waitForTimeout(1_000);
    try {
      controlled = await page.evaluate(() => Boolean(navigator.serviceWorker?.controller));
    } catch {
      // The expected controllerchange reload can destroy a single evaluation context.
    }
  }
  expect(controlled, "service worker should control the local app after activation").toBe(true);

  for (const route of routes) {
    const response = await page.goto(route, { waitUntil: "commit" });
    expect(response, "navigation response missing for " + route).not.toBeNull();
    expect(response.status(), "unexpected HTTP status for " + route).toBe(200);
    expect(new URL(page.url()).pathname).toBe(route);
  }

  expect(failedNavigations).toEqual([]);
});
