// Dev helper: render the app in headless Chromium (GPU) and save screenshots.
// usage: node scripts/shot.mjs out.png [--js "<code>"] [--wait ms] [--theme dark|light] [--size 1440x900]
import { chromium } from "playwright-core";
import os from "node:os";

const args = process.argv.slice(2);
const out = args[0] ?? "shot.png";
const get = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const js = get("--js", "");
const wait = Number(get("--wait", "2500"));
const theme = get("--theme", "light");
const [w, h] = get("--size", "1440x900").split("x").map(Number);
const url = get("--url", "http://localhost:3000/");

const browser = await chromium.launch({
  executablePath: `${os.homedir()}/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome`,
  args: ["--use-angle=vulkan", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-features=Vulkan", "--enable-unsafe-swiftshader"],
});
const page = await browser.newPage({ viewport: { width: w, height: h }, colorScheme: theme, deviceScaleFactor: 1 });
const logs = [];
page.on("console", (m) => { if (["error", "warning"].includes(m.type())) logs.push(`[${m.type()}] ${m.text()}`); });
page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(url, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => window.__ready && window.__scene.getState().carId === window.__ready, null, { timeout: 120000 }).catch(() => logs.push("timeout waiting for scene"));
await page.waitForTimeout(1500);
if (js) {
  const r = await page.evaluate(js).catch((e) => `eval error: ${e.message}`);
  if (r !== undefined) console.log("js:", typeof r === "string" ? r : JSON.stringify(r));
}
await page.waitForTimeout(wait);
for (const t of (get("--click-text", "") || "").split("|").filter(Boolean)) {
  await page.getByText(t, { exact: true }).first().click();
  await page.waitForTimeout(700);
}
const hoverText = get("--hover-text", "");
if (hoverText) {
  await page.getByText(hoverText, { exact: true }).first().hover();
  await page.waitForTimeout(800);
  console.log("hovered text → state:", await page.evaluate(() => window.__scene.getState().hovered));
}
const hover = get("--hover", "");
if (hover) {
  // project a part's world-space center to screen and move the real mouse there
  const pt = await page.evaluate((id) => {
    const { scene, camera, size } = window.__three;
    let obj = null;
    scene.traverse((o) => { if (o.userData?.partId === id) obj = o; });
    if (!obj) return null;
    const THREE_Box = obj.children.find((c) => c.isMesh)?.geometry ? null : null;
    void THREE_Box;
    const box = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
    obj.updateWorldMatrix(true, true);
    obj.traverse((m) => {
      if (!m.isMesh) return;
      m.geometry.computeBoundingBox();
      const b = m.geometry.boundingBox.clone().applyMatrix4(m.matrixWorld);
      for (let k = 0; k < 3; k++) { box.min[k] = Math.min(box.min[k], b.min.getComponent(k)); box.max[k] = Math.max(box.max[k], b.max.getComponent(k)); }
    });
    const c = camera.position.clone().set((box.min[0] + box.max[0]) / 2, (box.min[1] + box.max[1]) / 2, (box.min[2] + box.max[2]) / 2);
    c.project(camera);
    const canvas = document.querySelector("canvas").getBoundingClientRect();
    return { x: canvas.left + (c.x * 0.5 + 0.5) * size.width, y: canvas.top + (-c.y * 0.5 + 0.5) * size.height };
  }, hover);
  if (pt) {
    await page.mouse.move(pt.x - 30, pt.y - 30);
    await page.mouse.move(pt.x, pt.y, { steps: 6 });
    await page.waitForTimeout(600);
    const hovered = await page.evaluate(() => window.__scene.getState().hovered);
    console.log("hover at", Math.round(pt.x), Math.round(pt.y), "→ hovered:", hovered);
  } else console.log("hover target not found", hover);
}
const info = await page.evaluate(() => {
  const c = document.querySelector("canvas");
  const gl = c?.getContext("webgl2");
  const dbg = gl?.getExtension("WEBGL_debug_renderer_info");
  return { renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : "?" };
}).catch(() => ({}));
await page.screenshot({ path: out });
console.log("saved", out, JSON.stringify(info));
for (const l of logs.slice(0, 25)) console.log(l);
await browser.close();
