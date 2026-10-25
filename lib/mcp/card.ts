import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";

// The ui://crankwell/card resource: one self-contained HTML page (no external origins, so the CSP
// stays empty). The ext-apps client bundle is inlined from node_modules with its trailing `export`
// turned into a global, then the view script reads it.

const EXT_BUNDLE = path.join(process.cwd(), "node_modules", "@modelcontextprotocol", "ext-apps", "dist", "src", "app-with-deps.js");
const VIEW = path.join(process.cwd(), "lib", "mcp", "ui", "card-view.js");
const WANTED = ["App", "applyDocumentTheme", "applyHostStyleVariables", "applyHostFonts"];

/** `export{a as App,b as c};` at the end of the ESM bundle → `globalThis.__crankwellExt = { App: a, ... }`. */
export function exposeBundle(src: string): string {
  const body = src.replace(/\n\/\/# sourceMappingURL=.*$/m, "");
  const m = body.match(/export\s*\{([^}]*)\}\s*;?\s*$/);
  if (!m) throw new Error("ext-apps bundle: export list not found");
  const names = new Map(
    m[1].split(",").map((pair) => {
      const [local, exported = local] = pair.trim().split(/\s+as\s+/);
      return [exported, local] as const;
    }),
  );
  const missing = WANTED.filter((n) => !names.has(n));
  if (missing.length) throw new Error(`ext-apps bundle: missing ${missing.join(", ")}`);
  return `${body.slice(0, m.index)}\nglobalThis.__crankwellExt = { ${WANTED.map((n) => `${n}: ${names.get(n)}`).join(", ")} };`;
}

const CSS = `
:root {
  --bg: var(--color-background-primary, #fff);
  --bg2: var(--color-background-secondary, #f5f4ed);
  --text: var(--color-text-primary, #141413);
  --muted: var(--color-text-secondary, #3d3d3a);
  --faint: var(--color-text-tertiary, #73726c);
  --line: var(--color-border-tertiary, rgba(31,30,29,.15));
  --line2: var(--color-border-secondary, rgba(31,30,29,.3));
  --inv: var(--color-background-inverse, #141413);
  --inv-text: var(--color-text-inverse, #fff);
  --ok-bg: var(--color-background-success, #e9f1dc); --ok: var(--color-text-success, #265b19);
  --warn-bg: var(--color-background-warning, #f6eedf); --warn: var(--color-text-warning, #5a4815);
  --bad-bg: var(--color-background-danger, #f7ecec); --bad: var(--color-text-danger, #7f2c28);
  --info: var(--color-text-info, #3266ad);
  --ring: var(--color-ring-info, rgba(50,102,173,.5));
  --accent: #e8590c;
  --r: var(--border-radius-lg, 10px); --r-sm: var(--border-radius-md, 8px);
  --bw: var(--border-width-regular, .5px);
  --font: var(--font-sans, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif);
  --xs: var(--font-text-xs-size, 12px); --sm: var(--font-text-sm-size, 14px); --md: var(--font-text-md-size, 16px);
  --h: var(--font-heading-md-size, 16px);
  color-scheme: light dark;
}
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {
  --bg: var(--color-background-primary, #30302e); --bg2: var(--color-background-secondary, #262624);
  --text: var(--color-text-primary, #faf9f5); --muted: var(--color-text-secondary, #c2c0b6); --faint: var(--color-text-tertiary, #9c9a92);
  --line: var(--color-border-tertiary, rgba(222,220,209,.15)); --line2: var(--color-border-secondary, rgba(222,220,209,.3));
  --inv: var(--color-background-inverse, #faf9f5); --inv-text: var(--color-text-inverse, #141413);
  --ok-bg: var(--color-background-success, #1b4614); --ok: var(--color-text-success, #7ab948);
  --warn-bg: var(--color-background-warning, #483a0f); --warn: var(--color-text-warning, #d1a041);
  --bad-bg: var(--color-background-danger, #602a28); --bad: var(--color-text-danger, #ee8884);
  --info: var(--color-text-info, #80aadd); --accent: #ff8a3d;
} }
:root[data-theme="dark"] {
  --bg: var(--color-background-primary, #30302e); --bg2: var(--color-background-secondary, #262624);
  --text: var(--color-text-primary, #faf9f5); --muted: var(--color-text-secondary, #c2c0b6); --faint: var(--color-text-tertiary, #9c9a92);
  --line: var(--color-border-tertiary, rgba(222,220,209,.15)); --line2: var(--color-border-secondary, rgba(222,220,209,.3));
  --inv: var(--color-background-inverse, #faf9f5); --inv-text: var(--color-text-inverse, #141413);
  --ok-bg: var(--color-background-success, #1b4614); --ok: var(--color-text-success, #7ab948);
  --warn-bg: var(--color-background-warning, #483a0f); --warn: var(--color-text-warning, #d1a041);
  --bad-bg: var(--color-background-danger, #602a28); --bad: var(--color-text-danger, #ee8884);
  --info: var(--color-text-info, #80aadd); --accent: #ff8a3d;
}
* { box-sizing: border-box; }
html, body { margin: 0; background: transparent; color: var(--text); font: var(--sm)/1.4 var(--font); -webkit-font-smoothing: antialiased; }
#root { padding: 16px; }
h2 { margin: 0; font-size: var(--h); line-height: 1.3; font-weight: 600; text-wrap: balance; }
p { margin: 0; }
.stack { display: grid; gap: 12px; }
.eyebrow { display: flex; align-items: center; gap: 6px; font-size: var(--xs); color: var(--faint); }
.eyebrow .brand { color: var(--text); font-weight: 600; }
.grow { flex: 1; }
.sub { margin-top: 2px; color: var(--muted); font-size: var(--xs); }
.faint { color: var(--faint); }
.ic { width: 16px; height: 16px; flex: none; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.ic.sm { width: 13px; height: 13px; }
.chip { border-radius: 999px; padding: 2px 8px; font-size: 11px; font-weight: 500; background: var(--bg2); color: var(--muted); }
.chip.high, .chip.critical { background: var(--bad-bg); color: var(--bad); }
.chip.moderate { background: var(--warn-bg); color: var(--warn); }
.paypal { font-weight: 700; font-style: italic; color: #0070e0; letter-spacing: -.01em; }
[data-theme="dark"] .paypal { color: #5aa9ff; }
.banner { display: flex; gap: 10px; align-items: flex-start; border-radius: var(--r-sm); padding: 10px 12px; font-size: var(--xs); }
.banner .ic { margin-top: 1px; }
.banner strong { display: block; font-size: var(--sm); font-weight: 600; }
.banner.danger { background: var(--bad-bg); color: var(--bad); }
.banner.warning { background: var(--warn-bg); color: var(--warn); }
.banner.success { background: var(--ok-bg); color: var(--ok); }
.suspects { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
.row { display: flex; justify-content: space-between; gap: 8px; align-items: baseline; }
.name { font-weight: 500; }
.pct { font-variant-numeric: tabular-nums; color: var(--muted); font-size: var(--xs); }
.bar { height: 4px; border-radius: 999px; background: var(--bg2); margin: 5px 0 4px; overflow: hidden; }
.bar i { display: block; height: 100%; border-radius: inherit; background: var(--accent); }
.suspects li:not(:first-child) .bar i { background: var(--line2); }
.why { color: var(--muted); font-size: var(--xs); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.options { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
.options li { display: flex; gap: 10px; align-items: center; border: var(--bw) solid var(--line2); border-radius: var(--r); padding: 10px; }
.options li.chosen { border-color: var(--info); box-shadow: 0 0 0 2px var(--ring); }
.tile { width: 32px; height: 32px; flex: none; display: grid; place-items: center; border-radius: var(--r-sm); background: var(--bg2); color: var(--muted); }
.body { flex: 1; min-width: 0; }
.title { font-weight: 500; }
.meta { font-size: var(--xs); color: var(--faint); margin: 1px 0 3px; }
.lines { margin: 0; display: grid; gap: 6px; font-size: var(--xs); }
.lines div { display: flex; justify-content: space-between; gap: 12px; }
.lines dt { color: var(--muted); }
.lines dd { margin: 0; font-variant-numeric: tabular-nums; }
.lines .total { border-top: var(--bw) solid var(--line2); padding-top: 8px; margin-top: 2px; font-size: var(--sm); font-weight: 600; }
.lines .total dt { color: var(--text); }
.policy { display: flex; gap: 6px; align-items: center; font-size: var(--xs); color: var(--muted); }
.actions { display: flex; gap: 8px; flex-wrap: wrap; }
.actions .btn { flex: 1 1 140px; }
.btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: 44px; padding: 0 14px; border-radius: var(--r-sm);
  border: var(--bw) solid var(--line2); background: transparent; color: var(--text); font: 500 var(--sm) var(--font); cursor: pointer; }
.btn:hover { background: var(--bg2); }
.btn:focus-visible, .link:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; }
.btn.primary { background: var(--inv); color: var(--inv-text); border-color: transparent; font-weight: 600; }
.btn.primary:hover { opacity: .9; }
.btn.wide { width: 100%; }
.btn.small { min-height: 36px; padding: 0 12px; font-size: var(--xs); }
.btn:disabled { opacity: .55; cursor: default; }
.link { display: inline-flex; align-items: center; gap: 4px; border: 0; background: none; padding: 0; color: var(--info); font: 500 var(--xs) var(--font); cursor: pointer; }
.note { font-size: var(--xs); color: var(--muted); text-align: center; }
.error { font-size: var(--xs); color: var(--bad); }
.pulse { animation: pulse 1.4s ease-in-out infinite; }
@keyframes pulse { 50% { opacity: .45; } }
.sk { border-radius: 6px; background: var(--bg2); animation: pulse 1.4s ease-in-out infinite; }
@media (prefers-reduced-motion: reduce) { .pulse, .sk { animation: none; } }
`;

const SKELETON = `<section class="stack" aria-busy="true" aria-label="Loading"><div class="sk" style="height:12px;width:40%"></div><div class="sk" style="height:18px;width:75%"></div><div class="sk" style="height:44px"></div><div class="sk" style="height:56px"></div></section>`;

let cached: Promise<string> | undefined;

export function cardHtml(): Promise<string> {
  if (process.env.NODE_ENV === "development") cached = undefined;
  cached ??= Promise.all([readFile(EXT_BUNDLE, "utf8"), readFile(VIEW, "utf8")])
    .then(([bundle, view]) => {
      const scripts = [exposeBundle(bundle), view];
      if (scripts.some((s) => /<\/script/i.test(s))) throw new Error("card scripts must not contain </script");
      return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light dark">
<title>Crankwell</title><style>${CSS}</style></head>
<body><main id="root">${SKELETON}</main>
<script type="module">${scripts[0]}</script>
<script type="module">${scripts[1]}</script>
</body></html>`;
    })
    .catch((e) => {
      cached = undefined;
      throw e;
    });
  return cached;
}
