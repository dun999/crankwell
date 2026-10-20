# Crankwell

An AI mechanic built on **Nemotron** (Nebius Token Factory) and **PayPal**. Users explore detailed, procedurally built 3D models of a **Toyota Corolla** (E210, 2.0 L M20A, FWD) and a **Honda CR-V** (1.5 L turbo L15B, AWD). They describe what's wrong in a chat, and the agent:

1. moves the camera to the suspect parts, x-rays the rest of the car, and labels each suspect with its confidence,
2. asks for **safe** checks that tell the suspects apart,
3. updates the diagnosis, then offers a do-it-yourself fix, a spare part, a mobile technician, or a repair-shop reservation.

Every payment goes through PayPal (sandbox): **Orders v2**, **Payments v2** (authorize, capture, void, refund), **Invoicing v2**, and **Webhooks**.

![stack](https://img.shields.io/badge/Next.js-16-black) ![three](https://img.shields.io/badge/three.js-r186-blue) ![nemotron](https://img.shields.io/badge/Nemotron-3.5%20Lightning-76B900) ![paypal](https://img.shields.io/badge/PayPal-sandbox-003087)

---

## Quick start

```bash
pnpm install
cp .env.example .env.local        # fill in the keys below
pnpm dev                           # http://localhost:3000
```

| Variable | Where to get it |
|---|---|
| `NEBIUS_API_KEY` | [tokenfactory.nebius.com](https://tokenfactory.nebius.com/) → API keys |
| `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` | developer.paypal.com → Apps & Credentials → **Sandbox** → your app |
| `NEXT_PUBLIC_PAYPAL_CLIENT_ID` | same client id (used by the PayPal JS SDK in the browser) |
| `INVOICE_RECIPIENT_EMAIL` | developer.paypal.com → Testing tools → Sandbox accounts → your **Personal** account email |
| `PAYPAL_WEBHOOK_ID` | printed by `pnpm webhook:register` (see below) |

The 3D model and parts explorer work without any keys. The chat needs the Nebius key, and checkout needs the PayPal keys. The chat model defaults to `nvidia/Nemotron-3_5-Lightning` (`NEBIUS_MODEL` overrides it).

### PayPal sandbox walkthrough

1. **Sandbox accounts.** PayPal creates a *Business* account (the merchant behind your app) and a *Personal* account (the buyer). Log in with the Personal account in the PayPal popup during checkout.
2. **Webhooks (optional but recommended).** PayPal only delivers webhooks to public HTTPS URLs, so expose your dev server and register the endpoint:
   ```bash
   pnpm dlx cloudflared tunnel --url http://localhost:3000     # prints https://<name>.trycloudflare.com
   pnpm webhook:register https://<name>.trycloudflare.com --write
   # restart `pnpm dev` so PAYPAL_WEBHOOK_ID is picked up
   ```
   Without webhooks everything still works: the server updates orders from the capture, authorize and invoice API responses, and you can refresh an invoice's status by hand. Webhooks add live push updates. For example, the technician booking confirms itself when the buyer pays the invoice.

## What PayPal does where

| User action | PayPal API | Flow |
|---|---|---|
| Buy a spare part | **Orders v2** `intent=CAPTURE` | Server prices the order from the catalog (the client never sends prices) → buyer approves in the JS SDK v6 popup → server captures |
| Cancel a part order | **Payments v2** refund | `POST /v2/payments/captures/{id}/refund` |
| Reserve a repair shop slot | **Orders v2** `intent=AUTHORIZE` | A refundable diagnostic deposit is *held*, not charged |
| Check in / cancel the reservation | **Payments v2** | Capture the authorization at check-in, or void it on cancel |
| Book a mobile technician | **Invoicing v2** | Generate number → create draft → send → buyer pays on PayPal's hosted invoice page |
| Live status | **Webhooks** | `/api/paypal/webhook` verifies every event with `verify-webhook-signature`, dedupes by event id, never downgrades state on out-of-order delivery, and pushes updates to the browser over SSE |

Server code: `lib/server/paypal.ts` uses the official `@paypal/paypal-server-sdk` for Orders and Payments. Invoicing and webhook verification aren't in that SDK, so they call the REST API directly with the same OAuth credentials. The browser uses `@paypal/react-paypal-js/sdk-v6`.

## The agent

`lib/agent/` runs a streaming, manual tool loop on Nebius Token Factory (`nvidia/Nemotron-3_5-Lightning` by default):

- OpenAI-compatible chat completions at `https://api.tokenfactory.nebius.com/v1/`
- reasoning notes, when the model sends them, show as status lines in the chat and are replayed on later tool turns (DeepSeek requires `reasoning_content`)
- history kept server-side in SQLite
- every tool input checked with zod; invalid input is returned to the model so it can correct itself

| Tool | Effect in the UI |
|---|---|
| `show_diagnosis` | Camera flies to the suspects, other systems are ghosted, confidence labels appear, and a diagnosis card with drive-safety guidance |
| `focus_parts` | Points the camera at parts (switches car if needed) |
| `request_safety_tests` | Checklist card. The user taps answers, which go back to the agent |
| `get_part_info`, `search_spare_parts` | Catalog lookups (purpose, typical price, DIY difficulty, SKUs) |
| `find_repair_shops`, `find_technicians` | Seeded demo providers near the user's location |
| `recommend_actions` | Option cards with built-in PayPal checkout, a shop deposit or a technician invoice |
| `get_orders` | Answers "did my payment go through?" |

The system prompt enforces safety rules. A sinking brake pedal means *do not drive*. Checks are limited to static, engine-idling-in-Park, or walking-pace tests. The agent never asks the user to work under a car on a jack or open a hot radiator.

## The 3D models

Everything is built in code (`lib/three/`): no downloaded models, no HDRIs, roughly 2.2 M triangles per car, rendered on the local GPU.

- **Body:** one analytic lofted surface `S(x, v)` driven by per-car profile curves (roofline, beltline, sills, wheel arches, plan-view corners, nose and tail rake). Each panel (hood, doors, fenders, bumpers, glass, lamps) is sampled from that surface on its own, so panels have real gaps and come off independently.
- **Machinery:** about 70 parametric builders. Some highlights:
  - lathed tires with a 69k-vertex tread pattern
  - multi-spoke rims, vented rotors, calipers with pads, coil-over struts and multi-link arms
  - an engine block with real bores, pistons and rods at their crank angles, crankshaft, cams and timing chain, and a serpentine belt wrapped around the pulleys
  - turbo volutes, CVT, AWD prop shaft and rear differential
  - radiator, fans, fuel tank, exhaust with cat and muffler, brake and fuel lines, and the interior
- **Parts and pricing:** 118 parts (Corolla) and 125 (CR-V). Each has a purpose note, typical 2026 US price range (parts and labor), DIY difficulty, symptoms and lifespan (`lib/cars/parts-library.ts`).
- **Disassembly:** staged and animated. The body comes off first, then wheels and brakes, suspension, and finally the powertrain lifts out and the engine internals separate.
- **Rendering:** clearcoat flake paint, transmissive lenses, procedural normal maps, a studio built from light-formers, VSM soft shadows, N8AO, bloom on the LEDs, an outline on hover, and light and dark studio themes.

## AG Grid

Two views use AG Grid Community (`ag-grid-community` + `ag-grid-react` v36). Both load only when opened, so they add nothing to the first page load.

- **Price guide** (`components/hud/PriceGuide.tsx`): every part of the car on screen with part price, shop labor, typical repair total, DIY difficulty and lifespan. Quick filter searches names *and* failure symptoms ("brake light out" finds the tail lamps); an external filter narrows by system or to parts sold in the store. The grid drives the 3D view: hovering a row outlines that part on the car, clicking flies the camera to it and opens its details, and selecting a part anywhere else (3D click, search, the agent's diagnosis) selects and scrolls to its row.
- **Orders ledger** (`components/commerce/OrdersLedger.tsx`): every PayPal order, shop deposit and invoice with live status (webhook-pushed rows are marked), the current PayPal reference (capture, authorization, refund or invoice), and totals for paid, on hold, awaiting payment and refunded. Selecting a row opens its timeline and the actions PayPal allows next: refund, capture or void the deposit, pay or cancel the invoice.

The theme (`components/grid/theme.ts`) is Quartz with the app's CSS variables, so the grids follow light and dark mode, and registers only the community modules the two grids use. Columns adapt to the grid's width, down to part + total on a phone.

## Scripts

```bash
pnpm test             # vitest: catalog integrity, pricing, agent tools, PayPal state machine, geometry
pnpm typecheck && pnpm lint && pnpm build
pnpm webhook:register <https-url> [--write]
node scripts/shot.mjs out.png [--theme dark] [--size 390x844] [--js "<code>"]   # headless GPU screenshot (dev)
```

## Project layout

```
app/api/agent            Nemotron agent via Nebius (SSE stream)
app/api/paypal/*         orders, capture, authorize, deposit capture/void, refunds, invoices, webhook
app/api/events           live transaction updates (SSE)
components/scene         R3F canvas, studio, part meshes, camera rig
components/chat          sidebar + diagnosis / safety-test / recommendation cards
components/commerce      PayPal button, parts shop, shop reservation, technician invoice, orders drawer + AG Grid ledger
components/grid          AG Grid theme and module registration
lib/cars                 car specs, part templates (notes + prices), layout generator
lib/three                body surface, materials, procedural textures, part builders
lib/agent                prompt, tools, loop
lib/server               SQLite, PayPal client, commerce state machine
```

## Notes

- Shops and technicians are seeded demo data placed around the browser's location (or San Jose, CA by default). They aren't real businesses.
- Prices are typical market estimates, not quotes.
- The agent gives guidance, not a guaranteed diagnosis. Anything safety-critical should be inspected by a qualified mechanic.
