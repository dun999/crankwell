// Run against a production server: pnpm perf http://localhost:3000
import { chromium } from "playwright-core";

const url = process.argv[2] ?? "http://localhost:3000";
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? chromium.executablePath(),
  args: ["--use-angle=vulkan", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-features=Vulkan", "--enable-unsafe-swiftshader"],
});

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: "light", deviceScaleFactor: 1 });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    const raf = window.requestAnimationFrame;
    let frame = 0, previousFrame = -1;
    window.__renderBenchmark = { frames: 0, draws: 0 };
    window.requestAnimationFrame = (callback) => raf.call(window, (time) => { frame = time; callback(time); });
    for (const method of ["drawElements", "drawArrays", "drawElementsInstanced", "drawArraysInstanced"]) {
      const draw = WebGL2RenderingContext.prototype[method];
      WebGL2RenderingContext.prototype[method] = function (...args) {
        const counts = window.__renderBenchmark;
        counts.draws++;
        if (frame !== previousFrame) { counts.frames++; previousFrame = frame; }
        return draw.apply(this, args);
      };
    }
  });

  const response = await page.goto(url, { waitUntil: "domcontentloaded" });
  if (!response?.ok()) throw new Error(`Page returned ${response?.status() ?? "no response"}`);
  const html = await response.text();
  const initialScripts = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"[^>]*>/gi)]
    .filter(([tag]) => !/\bnomodule\b/i.test(tag))
    .map(([, src]) => new URL(src, response.url()).href);

  await page.waitForFunction(() => window.__renderBenchmark.draws > 2500 && !document.body.textContent.includes("Building 3D model"), null, { timeout: 120_000 });
  // Let shader compilation and the opening camera transition settle before
  // measuring idle rendering. These local samples are not field Web Vitals.
  await page.waitForTimeout(10_000);
  const start = await page.evaluate(() => ({ ...window.__renderBenchmark, time: performance.now() }));
  await page.waitForTimeout(5_000);
  const result = await page.evaluate(({ start, initialScripts }) => {
    const resources = performance.getEntriesByType("resource");
    const initial = resources.filter((entry) => initialScripts.includes(entry.name));
    const local = resources.filter((entry) => new URL(entry.name).origin === location.origin);
    const brand = local.filter((entry) => entry.name.includes("crankwell-mark") || entry.name.includes("crankwell-logo"));
    const canvas = document.querySelector("canvas");
    return {
      initialJavaScript: {
        decodedBytes: initial.reduce((sum, entry) => sum + entry.decodedBodySize, 0),
        transferredBytes: initial.reduce((sum, entry) => sum + entry.transferSize, 0),
      },
      localResourceBytes: local.reduce((sum, entry) => sum + entry.decodedBodySize, 0),
      brandImages: {
        decodedBytes: brand.reduce((sum, entry) => sum + entry.decodedBodySize, 0),
        transferredBytes: brand.reduce((sum, entry) => sum + entry.transferSize, 0),
      },
      canvasPixels: canvas ? canvas.width * canvas.height : 0,
      idle: {
        durationMs: Math.round(performance.now() - start.time),
        frames: window.__renderBenchmark.frames - start.frames,
        drawCalls: window.__renderBenchmark.draws - start.draws,
      },
    };
  }, { start, initialScripts });
  console.log(JSON.stringify({ url, ...result, errors }, null, 2));
  if (errors.length) process.exitCode = 1;
} finally {
  await browser.close();
}
