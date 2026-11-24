import { test, expect } from "@playwright/test";

const routes = [
  "/home.html",
  "/discover.html",
  "/library.html",
  "/for-you.html",
  "/search.html",
  "/account.html",
  "/watch.html",
  "/anime.html",
  "/community.html"
];

test("core app routes remain navigable with the service worker active", async ({ page }) => {
  const failedNavigations = [];
  page.on("requestfailed", request => {
    // Firebase Auth and other third-party iframes can be cancelled when the test
    // navigates away from a route. Only local app-document failures are relevant.
    if (request.isNavigationRequest() && request.url().startsWith("http://127.0.0.1:4173/")) {
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


test("mobile navigation stays within five destinations and exposes secondary routes through More", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/home.html", { waitUntil: "domcontentloaded" });
  await expect(page.locator(".vivid-navlinks a[href='my-downloads.html']")).toHaveCount(0);
  await expect(page.locator(".vivid-mobile-nav a[href='my-downloads.html']")).toHaveCount(0);
  await expect(page.locator(".vivid-mobile-nav a")).toHaveCount(4);
  await expect(page.locator(".vivid-mobile-nav button[data-vivid-more-navigation]")).toHaveCount(1);
  const watchRoomsIcon = page.locator(".vivid-watch-rooms-nav");
  await expect(watchRoomsIcon).toHaveAttribute("href", "watch-rooms.html");
  await expect(watchRoomsIcon).toBeVisible();
  const iconBounds = await watchRoomsIcon.boundingBox();
  expect(iconBounds).not.toBeNull();
  expect(iconBounds.x).toBeGreaterThanOrEqual(0);
  expect(iconBounds.x + iconBounds.width).toBeLessThanOrEqual(390);
  await expect(page.locator(".vivid-mobile-nav a")).toHaveCount(4);
  await page.locator("[data-vivid-more-navigation]").click();
  const moreMenu = page.locator("#vivid-more-menu");
  await expect(moreMenu).toBeVisible();
  for (const href of ["discover.html", "anime.html", "community.html", "library.html", "account.html", "search.html", "watch-rooms.html"]) {
    await expect(moreMenu.locator("a").filter({ has: page.locator("a[href='" + href + "']") })).toHaveCount(1);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.locator(".vivid-navlinks a")).toHaveCount(8);
  for (const href of ["collection.html?collection=movies", "collection.html?collection=tv", "anime.html", "live.html", "community.html", "library.html", "account.html"]) {
    await expect(page.locator(".vivid-navlinks a[href='" + href + "']")).toHaveCount(1);
  }
});
