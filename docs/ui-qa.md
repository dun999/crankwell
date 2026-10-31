# UI review — 10 October 2026

**Re-run 1 November 2026:** every layout (desktop, laptop, tablet, mobile, small, landscape, collapsed chat, keyboard-sized, dark) and every interaction check passes. `pnpm qa:ui` now opens `/app`: since `/` became the landing page, whose exploded car leaves the frame on purpose, the script had been checking the wrong page.

## Scope and references

Review Crankwell's 3D explorer, parts, diagnostic chat, and checkout entry points across desktop, tablet, and mobile. Preserve the existing car models and commerce behavior.

- [Sketchfab viewer](https://sketchfab.com/developers/viewer/initialization): keep model navigation together, with secondary rendering controls behind settings.
- [Tesla service](https://www.tesla.com/support/service-visits): put the vehicle and concern first, with service management consistently reachable.
- [iFixit automotive troubleshooting](https://www.ifixit.com/Troubleshooting/Car_and_Truck): give users recognizable symptoms and searchable parts as starting points.
- [WCAG target sizes](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum): retain sufficient target size and spacing; use 44 px targets for primary touch controls.
- [Native modal dialogs](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/dialog): contain keyboard focus, make the background inert, and support Escape.

## Findings and placement plan

| Priority | Observed issue | Improvement |
| --- | --- | --- |
| High | At 820 × 1180 the systems list runs behind the toolbar and chat. | Give panels explicit grid regions; use a parts drawer below the desktop parts breakpoint. |
| High | Collapsing chat leaves the toolbar floating halfway up a phone screen. | Put controls in the viewer's own layout row so they follow its available space. |
| High | At 320 × 568 the part inspector is compressed behind the toolbar; description and actions become inaccessible. | Use a scrollable modal sheet for compact-screen part details. |
| High | Resizing from desktop to mobile crops the car because camera fitting only runs on reset/disassembly. | Fit all model bounds to the actual viewer dimensions on resize, including chat open/close. |
| High | Disassembly lowers the suspension, fuel tank and exhaust beneath the fixed ground plane (up to 0.468 m on the Corolla). | Move the floor and grid beneath the lowest animated part, including during reassembly. |
| Medium | A one-tap assembly action offers too little control. | Keep a 0–100% disassembly slider visible in the main toolbar on every screen size. |
| Medium | Tall, nearly square logo competes with the model and consumes header space. | Use the existing mark with a compact wordmark in one horizontal header. |
| Medium | Phone disassembly button has no accessible name; search has no visible close button or focus containment. | Label controls and inputs; use native dialogs with visible close actions. |
| Medium | Initial welcome copy and five long suggestions crowd the phone chat. | Shorten introductory copy and show recognizable symptom starters. |
| Medium | Icons and quantity controls are small for touch input. | Enlarge primary touch controls, preserve readable labels and visible keyboard focus. |
| Medium | Two small brand images download 557,170 bytes at source resolution. | Use responsive Next Image delivery at the displayed size. |
| Medium | Markdown, diagnostic cards and checkout SDK load before needed. | Split message rendering/cards; defer PayPal SDK loading until checkout is displayed. |

## Implemented placement

- At 1280 px and wider: systems/details on the left, the car in the center, and chat on the right.
- At 1024–1279 px: car and chat side by side; systems and details open in a modal.
- On phones and portrait tablets: viewer above chat, with a scrollable parts sheet. Focus, Isolate and Ask dismiss the sheet to reveal the destination. Short landscape screens use side-by-side panels.
- The assembly slider remains visible beside the model controls on larger screens and above them on phones. Its 44 px input area supports touch and keyboard operation; 0% is assembled and 100% fully disassembled.
- Secondary render quality and auto-rotation controls live in View settings. Orders and theme remain in the header.

The camera interpolates its overview angle as the slider changes. The floor uses actual animated part positions, so it follows intermediate states and system-specific disassembly without changing the parts' relative positions. The existing demand-rendering behavior remains in place.

## Verification plan

Check fresh loads and resize transitions at 320 × 568, 390 × 844, 820 × 1180, 1024 × 768, 1440 × 900, and phone landscape. Inspect light/dark themes, collapsed/open chat, both cars, part search/details, disassembly, settings, orders, keyboard focus and mocked chat. Check scrolling and overflow without creating payments or sending messages to a live AI service.

Run the existing tests, lint, TypeScript and production build. Compare production initial JavaScript, image transfer sizes and idle rendering with the same browser settings.

Baseline at 1440 × 900, DPR 1, High quality: 745,529 decoded initial JavaScript bytes, 227,126 transferred bytes, 2,932,540 local resource bytes, and 0 GPU draw calls during a 5,006 ms idle sample. These are local measurements, not field Web Vitals.

## QA results

The browser suite passes all six base viewports plus collapsed mobile chat, a keyboard-sized phone viewport, dark desktop with reduced motion, and a fresh touch-device load at DPR 3. No page overflow, panel overlap, clipped primary controls, cropped model bounds at the checked resting states, or unexpected page errors were found. Primary phone controls have at least 44 × 44 px interaction areas.

Interaction checks cover keyboard search and empty results, focus restoration and containment, systems/details, checkout opening without remounting the viewer, partial disassembly via pointer input, assembly endpoints via keyboard, floor clearance during both cars' animations, x-ray, reset, quality, rotation, vehicle switching, mocked streamed Markdown, retained chat, and lazy repair/booking cards. Disabling WebGL leaves parts search usable. The production touch-device check confirms Balanced renders at DPR 1 even on an emulated DPR 3 screen.

- `pnpm lint` — passed.
- `pnpm typecheck` — passed.
- `pnpm test` — 33 tests passed across 6 files.
- `pnpm build` — passed.
- `pnpm qa:ui http://127.0.0.1:3000 /tmp/crankwell-ui-qa/final` — passed; writes screenshots and `ui-report.json`.

Run UI QA against a development server because it uses the existing development-only scene hooks. The script mocks AI responses, orders, events, and public booking configuration. Checkout entry points are exercised without creating or approving payments. Physical iOS/Android devices, Safari/Firefox, live AI responses, and completed PayPal transactions were not tested in this UI pass. Changes are local; no deployment was performed.

## Production performance

Measured against `pnpm start` at 1440 × 900, DPR 1, High quality, with the same Chromium/GPU settings as the baseline. Byte counts come from Resource Timing; the canvas metric measures the render target, not frame rate.

| Metric | Before | After | Change |
| --- | ---: | ---: | ---: |
| Initial JavaScript, decoded | 745,529 | 600,168 | 19.5% lower |
| Initial JavaScript, transferred | 227,126 | 184,003 | 19.0% lower |
| All local resource bodies | 2,932,540 | 2,234,319 | 23.8% lower |
| Brand image bodies | 557,170 | 780 | 99.9% lower |
| Canvas pixels at DPR 1 | 1,296,000 | 522,504 | 59.7% lower |
| Idle draw calls over 5,006 ms | 0 | 0 | Preserved |

No unexpected page errors occurred in the production sample. PayPal's SDK is absent from the initial view and loads when checkout is opened. Smaller image delivery, deferred Markdown/repair/checkout modules, and excluding panels from the canvas reduce initial work. Balanced mode caps the mobile render target at DPR 1.

Reproduce with `pnpm perf http://127.0.0.1:3001` against the production server. These local measurements do not establish deployed Core Web Vitals or a frame-rate guarantee on physical devices.
