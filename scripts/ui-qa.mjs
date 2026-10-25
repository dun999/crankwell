// Run against the dev server: pnpm qa:ui http://localhost:3000 /tmp/crankwell-ui-qa
// The agent and order APIs are mocked. This never submits a payment.
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { chromium } from "playwright-core";

const url = process.argv[2] ?? "http://localhost:3000";
const out = process.argv[3] ?? "/tmp/crankwell-ui-qa";
await mkdir(out, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? chromium.executablePath(),
  args: ["--use-angle=vulkan", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-features=Vulkan", "--enable-unsafe-swiftshader"],
});
const report = { layouts: [], checks: [], errors: [] };

async function prepare(page) {
  page.on("pageerror", (e) => report.errors.push(e.message));
  await page.route("**/api/orders?*", (r) => r.fulfill({ json: { items: [] } }));
  await page.route("**/api/config", (r) => r.fulfill({ json: { invoiceRecipient: "qa@example.test" } }));
  await page.route("**/api/events?*", (r) => r.fulfill({ contentType: "text/event-stream", body: ": ready\n\n" }));
  await page.route("**/api/agent", (r) => r.fulfill({
    contentType: "text/event-stream",
    body: 'event: text\ndata: {"delta":"A weak **12 V battery** could explain the clicking. Keep the car parked while checking."}\n\nevent: done\ndata: {"stopReason":"stop"}\n\n',
  }));
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__ready && window.__three, null, { timeout: 120_000 });
  await page.waitForTimeout(1800);
}

async function checkLayout(page, name) {
  const layout = await page.evaluate(() => {
    const rect = (selector) => {
      const r = document.querySelector(selector)?.getBoundingClientRect();
      return r ? { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom } : null;
    };
    const controls = [...document.querySelectorAll('.app-header button, .app-header select, .viewer-toolbar button, .viewer-toolbar input')]
      .filter((e) => e.getBoundingClientRect().width > 0)
      .map((e) => ({ name: e.getAttribute("aria-label") || e.textContent.trim(), width: e.getBoundingClientRect().width, height: e.getBoundingClientRect().height, right: e.getBoundingClientRect().right }));
    return { width: innerWidth, height: innerHeight, overflow: document.documentElement.scrollWidth > innerWidth, viewer: rect("canvas"), toolbar: rect(".viewer-toolbar"), chat: rect(".chat-panel"), parts: rect(".parts-dock"), controls };
  });
  assert.equal(layout.overflow, false, `${name}: page overflows`);
  assert(layout.viewer.width > 100 && layout.viewer.height > 50, `${name}: viewer is unusably small`);
  const overlaps = (a, b) => a && b && a.x < b.right - 1 && a.right > b.x + 1 && a.y < b.bottom - 1 && a.bottom > b.y + 1;
  assert(!overlaps(layout.viewer, layout.chat), `${name}: chat covers model`);
  assert(!overlaps(layout.toolbar, layout.chat), `${name}: toolbar covers chat`);
  assert(!overlaps(layout.parts, layout.chat), `${name}: parts cover chat`);
  for (const c of layout.controls) {
    assert(c.name, `${name}: unnamed control`);
    assert(c.right <= layout.width + 1, `${name}: control clipped: ${c.name}`);
    assert(c.width >= 24 && c.height >= 24, `${name}: small control: ${c.name}`);
    if (layout.width < 768) assert(c.width >= 44 && c.height >= 44, `${name}: small touch control: ${c.name}`);
  }
  if (layout.chat) assert(layout.chat.bottom <= layout.height + 1, `${name}: chat off screen`);
  await page.screenshot({ path: `${out}/${name}.png` });
  report.layouts.push({ name, ...layout });
  console.log(`PASS ${name}`);
}

async function checkFraming(page) {
  const max = await page.evaluate(() => {
    const { scene, camera } = window.__three;
    scene.updateMatrixWorld(true);
    camera.updateMatrixWorld(true);
    const car = scene.getObjectByName(`car-${window.__scene.getState().carId}`);
    let box;
    car.traverse((mesh) => {
      if (!mesh.isMesh || !mesh.geometry.boundingBox) return;
      const bounds = mesh.geometry.boundingBox.clone().applyMatrix4(mesh.matrixWorld);
      if (box) box.union(bounds); else box = bounds;
    });
    let max = 0;
    for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
      const point = camera.position.clone().set(x, y, z).project(camera);
      max = Math.max(max, Math.abs(point.x), Math.abs(point.y));
    }
    return max;
  });
  assert(max <= 1.02, `Model cropped: projected bounding corner ${max}`);
}

async function checkFloorTransition(page) {
  const result = await page.evaluate(() => new Promise((resolve) => {
    let start, frames = 0, lowestClearance = Infinity;
    const sample = (time) => {
      start ??= time;
      const { scene } = window.__three;
      scene.updateMatrixWorld(true);
      const floor = scene.getObjectByName("studio-floor").position.y + 0.004;
      const car = scene.getObjectByName(`car-${window.__scene.getState().carId}`);
      car.traverse((mesh) => {
        if (!mesh.isMesh || !mesh.geometry.boundingBox) return;
        const box = mesh.geometry.boundingBox.clone().applyMatrix4(mesh.matrixWorld);
        lowestClearance = Math.min(lowestClearance, box.min.y - floor);
      });
      frames++;
      if (time - start < 1800) requestAnimationFrame(sample);
      else resolve({ frames, lowestClearance });
    };
    requestAnimationFrame(sample);
  }));
  assert(result.frames > 1, "Floor transition was not sampled");
  assert(result.lowestClearance >= -0.0001, `Part crossed floor by ${-result.lowestClearance} m`);
}

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: "light" });
  const paypalScripts = [];
  page.on("request", (r) => { if (r.resourceType() === "script" && /paypal\.com/.test(r.url())) paypalScripts.push(r.url()); });
  await prepare(page);
  const layouts = process.argv.includes("--interactions-only") ? [] : [["desktop", 1440, 900], ["laptop", 1024, 768], ["tablet", 820, 1180], ["mobile", 390, 844], ["small", 320, 568], ["landscape", 844, 390]];
  for (const [name, width, height] of layouts) {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(1800);
    await checkLayout(page, name);
    await checkFraming(page);
  }
  assert.equal(paypalScripts.length, 0, "PayPal SDK loaded before checkout");
  report.checks.push("Model fits after all viewport transitions; PayPal SDK deferred");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Collapse chat" }).click();
  await page.waitForTimeout(1800);
  await checkLayout(page, "mobile-collapsed");
  await checkFraming(page);
  await page.getByRole("button", { name: "Ask the mechanic" }).click();

  const search = page.getByRole("button", { name: "Search parts (Ctrl+K)", exact: true });
  await search.click();
  const input = page.getByRole("textbox", { name: "Search parts, actions or ask the mechanic", exact: true });
  await input.fill("zzzz-no-match");
  await input.press("ArrowDown");
  await input.fill("12 V battery");
  await input.press("Enter");
  await page.getByRole("dialog", { name: "Part details", exact: true }).waitFor();
  await page.getByRole("heading", { name: "12 V battery", exact: true }).waitFor();
  await page.screenshot({ path: `${out}/mobile-part.png` });
  const canvas = await page.locator("canvas").elementHandle();
  await page.getByRole("button", { name: "Buy", exact: true }).click();
  await page.getByText("Choose a part", { exact: true }).waitFor();
  await page.waitForFunction(() => document.querySelector('script[src*="paypal.com"]') || document.body.textContent.includes("Checkout is currently unavailable"));
  assert(await canvas.evaluate((e) => e === document.querySelector("canvas")), "Checkout remounted the viewer");
  await page.screenshot({ path: `${out}/mobile-checkout.png` });
  await page.getByRole("button", { name: "Close part details", exact: true }).click();
  await search.click();
  await page.keyboard.press("Escape");
  assert(await search.evaluate((e) => e === document.activeElement), "Search focus was not restored");
  report.checks.push("Search, empty results, keyboard selection, part drawer and focus restoration");

  await page.getByRole("button", { name: "Browse car systems" }).click();
  const parts = page.getByRole("dialog", { name: "Browse car systems" });
  await parts.getByTitle("Show Electrical parts", { exact: true }).click();
  await parts.getByRole("button", { name: /12 V battery/ }).click();
  await page.getByRole("heading", { name: "12 V battery", exact: true }).waitFor();
  await page.getByRole("button", { name: "Focus", exact: true }).click();
  assert.equal(await page.getByRole("dialog").count(), 0, "Focus should uncover the model on mobile");
  assert(await page.evaluate(() => window.__scene.getState().focus?.ids.includes("electrical.battery")), "Part focus missing");

  await page.getByRole("button", { name: "My orders & bookings" }).click();
  const orders = page.getByRole("dialog", { name: "Orders and bookings" });
  await orders.waitFor();
  for (let i = 0; i < 5; i++) await page.keyboard.press("Tab");
  assert(await orders.evaluate((e) => e.contains(document.activeElement)), "Focus escaped orders dialog");
  await page.keyboard.press("Escape");
  report.checks.push("Mobile systems browser and modal keyboard containment");

  await page.getByRole("button", { name: "View settings", exact: true }).click();
  await page.getByLabel("Render quality", { exact: true }).selectOption("balanced");
  await page.getByRole("button", { name: /Auto-rotate/ }).click();
  assert.equal(await page.evaluate(() => window.__scene.getState().autoRotate), true);
  await page.getByRole("button", { name: /Auto-rotate/ }).click();
  await page.keyboard.press("Escape");
  const assembly = page.getByRole("slider", { name: "Disassembly" });
  await assembly.press("Home");
  await assembly.press("ArrowRight");
  assert.equal(await page.evaluate(() => window.__scene.getState().explode), 0.01);
  const sliderBox = await assembly.boundingBox();
  await assembly.click({ position: { x: sliderBox.width / 2, y: sliderBox.height / 2 } });
  assert(Math.abs(await page.evaluate(() => window.__scene.getState().explode) - 0.5) < 0.02, "Slider should allow partial disassembly");
  await checkFloorTransition(page);
  await assembly.press("End");
  await checkFloorTransition(page);
  await page.waitForTimeout(600);
  await checkFraming(page);
  await page.screenshot({ path: `${out}/mobile-disassembled.png` });
  await assembly.press("Home");
  await checkFloorTransition(page);
  await page.getByRole("button", { name: "X-ray body", exact: true }).click();
  assert.equal(await page.evaluate(() => window.__scene.getState().xray), true);
  await page.getByRole("button", { name: "Reset view", exact: true }).click();
  report.checks.push("Continuous disassembly slider, reassembly, floor clearance through transitions, x-ray, reset, quality and rotation");

  await page.getByRole("combobox", { name: "Choose a car" }).selectOption("crv");
  await page.waitForFunction(() => window.__ready === "crv", null, { timeout: 120_000 });
  await page.waitForTimeout(1800);
  await checkFraming(page);
  await assembly.press("End");
  await checkFloorTransition(page);
  await assembly.press("Home");
  await checkFloorTransition(page);
  await page.getByRole("textbox", { name: "Describe your car problem" }).fill("My car just clicks");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await page.getByRole("log").getByText("12 V battery", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Collapse chat" }).click();
  await page.getByRole("button", { name: "Ask the mechanic" }).click();
  await page.getByRole("log").getByText("12 V battery", { exact: true }).waitFor();
  report.checks.push("CR-V selection, mocked streamed Markdown, chat retained after reopening");

  await page.setViewportSize({ width: 390, height: 460 });
  await page.getByRole("textbox", { name: "Describe your car problem" }).focus();
  await page.waitForTimeout(1200);
  await checkLayout(page, "mobile-keyboard-size");
  const composer = await page.locator(".chat-composer").boundingBox();
  assert(composer.y + composer.height <= 460, "Composer obscured at keyboard-sized viewport");

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await page.waitForTimeout(1800);
  await checkLayout(page, "desktop-dark");

  await page.evaluate(await readFile(new URL("./demo-brake.js", import.meta.url), "utf8"));
  await page.getByText("Do not drive. Park safely and arrange a repair or tow", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Between MIN and MAX", exact: true }).click();
  await page.getByRole("button", { name: "Send 1 result to the mechanic", exact: true }).waitFor();
  await page.evaluate(await readFile(new URL("./demo-recs.js", import.meta.url), "utf8"));
  await page.getByText("Lin Chen", { exact: true }).waitFor();
  await page.getByRole("button", { name: /Order an OE-spec master cylinder/ }).click();
  await page.getByText("Choose a part", { exact: true }).waitFor();
  await page.getByRole("button", { name: /Tow to a brake specialist/ }).click();
  await page.getByText("Precision Brake & Alignment", { exact: true }).waitFor();
  report.checks.push("Lazy diagnosis, safety-test and recommendation cards, technician form, parts checkout and shop reservation entry");

  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, colorScheme: "dark" });
  await prepare(mobile);
  assert.equal(await mobile.evaluate(() => window.__scene.getState().quality), "balanced", "Touch devices should start at Balanced");
  await checkLayout(mobile, "mobile-fresh-dark");
  await checkFraming(mobile);
  report.checks.push("Fresh mobile load at DPR 3, dark theme, reduced motion, keyboard-sized viewport");

  const fallback = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await fallback.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...args) {
      return type.includes("webgl") ? null : getContext.call(this, type, ...args);
    };
  });
  await fallback.route("**/api/orders?*", (r) => r.fulfill({ json: { items: [] } }));
  await fallback.route("**/api/events?*", (r) => r.fulfill({ contentType: "text/event-stream", body: ": ready\n\n" }));
  await fallback.goto(url);
  await fallback.getByText("3D viewing is unavailable", { exact: true }).waitFor();
  await fallback.getByRole("button", { name: "Search parts (Ctrl+K)", exact: true }).click();
  await fallback.getByRole("textbox", { name: "Search parts, actions or ask the mechanic", exact: true }).fill("battery");
  await fallback.getByRole("option", { name: /12 V battery/ }).waitFor();
  report.checks.push("WebGL failure leaves the app and parts search usable");
  assert.deepEqual(report.errors, []);
  console.log(JSON.stringify(report.checks, null, 2));
} finally {
  await writeFile(`${out}/ui-report.json`, JSON.stringify(report, null, 2));
  await browser.close();
}
