# Performance check — 1 November 2026

The same measurement after the hackathon polish (cookie sessions, LLM failover, after-sale changes,
Pay Later, spending limits, AG Grid Enterprise): production build of `/app` (the landing page now
lives at `/`), Chromium at 1440 × 900, `pnpm perf http://localhost:3125/app`.

| Measurement | 8 October | 1 November |
| --- | ---: | ---: |
| Initial JavaScript downloaded, decoded | 745,529 bytes | 653,443 bytes |
| Initial JavaScript transferred | 227,126 bytes | 203,576 bytes |
| Frames during a five-second idle sample | 0 | 0 |
| GPU draw calls during that sample | 0 | 0 |

AG Grid Enterprise (Ask, grouping, set filters, master/detail) is one lazy chunk of 1,312 KB decoded,
366 KB gzipped, fetched only when the price guide or the Orders panel opens.

# Performance update — 8 October 2026

Measured with production builds in Chromium at 1440 × 900, device pixel ratio 1,
the default High quality setting, and the light theme.

| Measurement | Before | After |
| --- | ---: | ---: |
| Initial JavaScript downloaded, decoded | 1,111,718 bytes | 745,529 bytes |
| Initial JavaScript transferred, including response overhead | 322,508 bytes | 227,126 bytes |
| Brand images | 777,035 bytes | 557,170 bytes |
| Frames during a five-second idle sample | 286 | 0 |
| GPU draw calls during that sample | 347,776 | 0 |

The initial desktop screenshots were pixel-for-pixel identical. Both WebP assets
were decoded and compared with the original PNGs: identical RGBA pixels at the
same dimensions. Initial JavaScript excludes the legacy `nomodule` fallback;
the Three.js scene still loads separately when the canvas mounts.

## Changes

- Move the shared confidence-color helper out of the Three.js module so chat
  does not pull the 3D engine into the initial page dependency graph.
- Render on demand, continuing frames for camera movement, disassembly,
  auto-rotation and pulsing highlights. Refresh cached shadows when parts move,
  appear, disappear or change between solid and x-ray rendering.
- Measure adaptive resolution only during active rendering, so idle time does
  not get mistaken for a slow GPU. Keep the existing quality settings, geometry,
  textures, lighting and effects.
- Share concurrent builds of the same car and report build progress at the
  existing yield points.
- Memoize chat messages and blocks; skip synchronous history serialization when
  only unpersisted state, such as the draft, changes. Actual history changes
  still save immediately.
- Serve lossless WebP brand assets through static imports for content-hashed
  caching, with intrinsic dimensions and no additional lossy transformation.

## Verification

`pnpm test`, `pnpm lint`, `pnpm typecheck` and `pnpm build` pass. The tests include
concurrent car construction and history persistence. Browser checks cover both
cars, cache reuse, disassembly/reassembly, auto-rotation, x-ray, part search,
camera focus, diagnosis labels, light/dark themes, streamed chat persistence,
and the 390 × 844 mobile layout. Chat responses are mocked during browser checks;
these checks do not create payments or call the live AI provider.

To repeat the production benchmark with the installed Playwright Chromium:

```sh
pnpm build
pnpm start
# In another terminal:
pnpm perf http://localhost:3000
```

Set `CHROMIUM_PATH` if Chromium is installed elsewhere. Use the same browser,
viewport, device scale and quality for comparisons. GPU shader compilation,
network conditions and hardware affect timing. These are local measurements;
they do not establish a field page-load or AI/PayPal response-time improvement.

## Deployment

Deployed to `https://crankwell.xyz` on `167.104.102.37` on 8 October 2026.
The app lives in `/crankwell`, runs as `crankwell.service` on `127.0.0.1:3010`,
and is proxied through `/etc/caddy/crankwell.caddy`. The service was stopped and
disabled and its Caddy import was missing before deployment; both were restored.
The service is enabled to start at boot. The existing Saga service and route
remain active.

The previous installation and proxy/service configuration were backed up to
`/root/backups/crankwell-before-perf-20261008.tar.gz`. The existing environment
file and all SQLite database files matched that backup immediately before the
updated service started. Source synchronization excluded those files.

The server build and all 33 tests passed. Public HTTPS returns 200; HTTP and
`www` redirect to the canonical HTTPS domain. The configuration and orders API
health checks passed. The deployed benchmark reported 745,529 decoded bytes
of initial JavaScript, 226,826 transferred bytes, zero idle GPU draw calls over
five seconds, and no browser runtime errors. PayPal remains in sandbox mode.
