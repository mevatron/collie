import { expect, test, type Page } from "@playwright/test";

import { en } from "@/lib/i18n/messages/en";
import { AUTH_BOX_LAST_URL, paneTextWithAuthBox } from "@/test/handlers";

import { installApiStub } from "./fixtures/api";

/** `IDLE_MS` in `src/hooks/use-polling.ts`: the gap between polls of a pane whose agent is idle. */
const IDLE_POLL_MS = 6_000;
/** A redraw has to land within a couple of polls; the half beats a poll that just missed. */
const REDRAW_TIMEOUT_MS = 2.5 * IDLE_POLL_MS;

const WIDE_BOX_INNER = 111;
const WIDE_ROW_LABEL = "Login output row drawn across the whole width of a wide box so that the card has to wrap it, row";

async function serveAuthBoxPane(page: Page, innerWidth?: number): Promise<{ redraw: (label: string) => void }> {
  let screenLabel = innerWidth === undefined ? "Login output row" : WIDE_ROW_LABEL;
  await installApiStub(page);
  await page.route(/\/api\/pane\/[^/?]+(\?.*)?$/, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ paneId: "w1:p1", text: paneTextWithAuthBox(60, screenLabel, innerWidth), truncated: false, revision: 1 }),
    }),
  );
  return {
    redraw: (label) => {
      screenLabel = label;
    },
  };
}

const DOCK = '[data-slot="card-dock"]';

/** Geometry is measured after the dock's actual enter transition, never after a guessed sleep. */
async function settleDock(page: Page) {
  const dock = page.locator(DOCK);
  await expect.poll(() => dock.evaluate((el) => el.closest('[data-slot="collapse"]')?.getAttribute("data-state"))).toBe("open");
  await dock.evaluate(async (el) => {
    const panel = el.closest('[data-slot="collapse"]');
    await Promise.all(panel?.getAnimations({ subtree: true }).map((animation) => animation.finished) ?? []);
  });
}

// No service worker: once it claims the page, WebKit sends the page's polls through it and
// `page.route` no longer sees them, so a redraw never reaches the page (the `webServer` note in
// playwright.config.ts). Nothing here needs the worker.
test.use({ serviceWorkers: "block" });

test("a cold dock chunk grows into the pane without a one-frame layout jump", async ({ page }) => {
  await serveAuthBoxPane(page);
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  const chunk = /\/card-dock-[^/]+\.js$/;
  await page.route(chunk, async (route) => { await held; await route.continue(); });
  const requested = page.waitForRequest(chunk);
  await page.goto("/pane/w1:p1", { waitUntil: "domcontentloaded" });
  await requested;
  try {
    await expect(page.getByRole("button", { name: en["nav.home.aria.default"] })).toBeVisible();
    expect(await page.locator(DOCK).count()).toBe(0);
    const samples = page.evaluate(async () => {
      const heights: number[] = [];
      for (let frame = 0; frame < 45; frame++) {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        const dock = document.querySelector('[data-slot="card-dock"]');
        const box = dock?.closest('[data-slot="collapse"]') ?? dock;
        heights.push(box?.getBoundingClientRect().height ?? 0);
      }
      return heights;
    });
    release();
    const heights = await samples;
    await expect(page.getByRole("group", { name: en["dialog.authBox.label"] })).toBeVisible();
    const full = Math.max(...heights);
    expect(full).toBeGreaterThan(100);
    const intermediate = new Set(heights.filter((height) => height > 1 && height < full - 1).map(Math.round));
    expect(intermediate.size).toBeGreaterThan(2);
  } finally {
    release();
  }
});

test("a tall dock yields to the reading floor and composer on a short viewport", async ({ page }) => {
  await serveAuthBoxPane(page);
  await page.setViewportSize({ width: page.viewportSize()!.width, height: 480 });
  await page.goto("/pane/w1:p1");
  await expect(page.getByRole("group", { name: en["dialog.authBox.label"] })).toBeVisible();
  await settleDock(page);
  await expect(page.getByRole("textbox", { name: en["composer.placeholder.reply"] })).toBeInViewport({ ratio: 1 });
  const reading = await page.locator('[data-slot="pane-reading"]').boundingBox();
  expect(reading!.height).toBeGreaterThanOrEqual(480 * 0.3 - 1);
});

test("a login box taller than the dock opens at its heading and scrolls to its last link", async ({ page }) => {
  await serveAuthBoxPane(page);
  await page.goto("/pane/w1:p1");
  const dock = page.locator(DOCK);
  const card = dock.getByRole("group", { name: en["dialog.authBox.label"] });
  await expect(card).toBeVisible();
  await settleDock(page);

  const overflow = await dock.evaluate((el) => ({ scrollHeight: el.scrollHeight, clientHeight: el.clientHeight, scrollTop: el.scrollTop }));
  expect(overflow.scrollHeight).toBeGreaterThan(overflow.clientHeight);
  expect(overflow.scrollTop).toBe(0);

  const dockBox = (await dock.boundingBox())!;
  const headingBox = (await card.getByText("Authentication", { exact: true }).boundingBox())!;
  expect(headingBox.y).toBeGreaterThanOrEqual(dockBox.y);
  expect(headingBox.y + headingBox.height).toBeLessThanOrEqual(dockBox.y + dockBox.height);

  const lastLink = card.getByRole("link", { name: AUTH_BOX_LAST_URL });
  const before = (await lastLink.boundingBox())!;
  expect(before.y).toBeGreaterThan(dockBox.y + dockBox.height);

  await dock.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  const after = (await lastLink.boundingBox())!;
  expect(after.y).toBeGreaterThanOrEqual(dockBox.y);
  expect(after.y + after.height).toBeLessThanOrEqual(dockBox.y + dockBox.height);
});

test("a refresh that redraws the box with other text keeps the dock where the operator scrolled it", async ({ page }) => {
  const pane = await serveAuthBoxPane(page);
  await page.goto("/pane/w1:p1");
  const dock = page.locator(DOCK);
  const card = dock.getByRole("group", { name: en["dialog.authBox.label"] });
  await expect(card).toContainText("Login output row 30");
  await settleDock(page);

  await dock.evaluate((el) => {
    el.scrollTop = 150;
  });
  const scrolled = await dock.evaluate((el) => el.scrollTop);
  expect(scrolled).toBeGreaterThan(0);

  pane.redraw("Redrawn output row");
  await expect(card).toContainText("Redrawn output row 30", { timeout: REDRAW_TIMEOUT_MS });
  await expect(card).not.toContainText("Login output row");
  expect(await dock.evaluate((el) => el.scrollTop)).toBe(scrolled);
});

test("a card row wider than the card wraps inside the dock instead of overflowing it sideways", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "app-tablet", "a phone-width case; the tablet is wide enough that no row wraps");
  await serveAuthBoxPane(page, WIDE_BOX_INNER);
  await page.goto("/pane/w1:p1");
  const dock = page.locator(DOCK);
  const card = dock.getByRole("group", { name: en["dialog.authBox.label"] });
  await expect(card).toBeVisible();
  await settleDock(page);

  const overflow = await dock.evaluate((el) => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);

  const lastLink = card.getByRole("link", { name: AUTH_BOX_LAST_URL });
  await lastLink.scrollIntoViewIfNeeded();
  const dockBox = (await dock.boundingBox())!;
  const linkBox = (await lastLink.boundingBox())!;
  expect(linkBox.x).toBeGreaterThanOrEqual(dockBox.x);
  expect(linkBox.x + linkBox.width).toBeLessThanOrEqual(dockBox.x + dockBox.width);
});
