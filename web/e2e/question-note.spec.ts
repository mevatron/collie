import { expect, test, type Page } from "@playwright/test";

import { en } from "@/lib/i18n/messages/en";
import { installApiStub, paneCapture } from "./fixtures/api";

const DOCK = '[data-slot="card-dock"]';

function sampleDock(page: Page) {
  return page.evaluate(async () => {
    const heights: number[] = [];
    for (let frame = 0; frame < 45; frame++) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      heights.push(document.querySelector('[data-slot="card-dock"]')!.getBoundingClientRect().height);
    }
    return heights;
  });
}

function intermediateHeights(heights: number[]) {
  const low = Math.min(...heights), high = Math.max(...heights);
  return new Set(heights.filter((height) => height > low + 1 && height < high - 1).map(Math.round));
}

test.use({ serviceWorkers: "block" });

test("a cold note editor closes its offer and opens its form without jumping", async ({ page }, testInfo) => {
  // Below the dock's height cap we can measure the form's effect on the reading area's space.
  test.skip(testInfo.project.name !== "app-tablet", "the tablet has room for the note form's full natural height");
  await installApiStub(page);
  await page.route(/\/api\/pane\/[^/?]+(\?.*)?$/, (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ paneId: "w1:p1", revision: 1, truncated: false, text: paneCapture("claude--select-preview") }),
  }));
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  const chunk = /\/question-note-editor-[^/]+\.js$/;
  await page.route(chunk, async (route) => { await held; await route.continue(); });
  await page.goto("/pane/w1:p1");
  const dock = page.locator(DOCK);
  const add = page.getByRole("button", { name: en["dialog.preview.addNote"] });
  await expect(add).toBeVisible();
  await expect.poll(() => dock.evaluate((el) => el.closest('[data-slot="collapse"]')?.getAttribute("data-state"))).toBe("open");
  await dock.evaluate(async (el) => {
    await Promise.all(el.closest('[data-slot="collapse"]')!.getAnimations({ subtree: true }).map((animation) => animation.finished));
  });
  try {
    const requested = page.waitForRequest(chunk);
    const closing = sampleDock(page);
    await add.click();
    await requested;
    expect(intermediateHeights(await closing).size).toBeGreaterThan(2);

    const opening = sampleDock(page);
    release();
    expect(intermediateHeights(await opening).size).toBeGreaterThan(2);
    await expect(page.getByRole("textbox", { name: en["dialog.preview.noteTextAria"] })).toBeVisible();
  } finally {
    release();
  }
});
