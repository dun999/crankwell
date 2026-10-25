# Crankwell

An AI mechanic built on **DeepSeek V4** (Boundless inference) and **PayPal**. Users explore detailed, procedurally built 3D models of a **Toyota Corolla** (E210, 2.0 L M20A, FWD) and a **Honda CR-V** (1.5 L turbo L15B, AWD). They describe what's wrong in a chat, and the agent:

1. moves the camera to the suspect parts, x-rays the rest of the car, and labels each suspect with its confidence,
2. asks for **safe** checks that tell the suspects apart,
3. updates the diagnosis, then offers a do-it-yourself fix, a spare part, a mobile technician, or a repair-shop reservation,
4. and when you say "buy it" or "book them", **prepares the checkout for you to confirm with one tap**. The AI prepares, you tap, PayPal executes.

The same mechanic works **inside Claude**: add Crankwell as a connector, describe your car's problem, and Claude shows the diagnosis, the fix options and a PayPal checkout card right in the conversation.

Every payment goes through PayPal (sandbox): **Orders v2**, **Payments v2** (authorize, capture, void, refund), **Vault** (saved PayPal for one-tap), **Invoicing v2**, and **Webhooks**.

![stack](https://img.shields.io/badge/Next.js-16-black) ![three](https://img.shields.io/badge/three.js-r186-blue) ![deepseek](https://img.shields.io/badge/DeepSeek-V4-4D6BFE) ![paypal](https://img.shields.io/badge/PayPal-sandbox-003087)

---

## Quick start

```bash
pnpm install
cp .env.example .env.local        # fill in the keys below
pnpm dev                           # http://localhost:3000
```

| Variable | Where to get it |
|---|---|
| `AGENT_API_KEY` | [inference.boundless.network](https://inference.boundless.network/) → API keys (any OpenAI-compatible provider works, see below) |
| `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` | developer.paypal.com → Apps & Credentials → **Sandbox** → your app |
| `NEXT_PUBLIC_PAYPAL_CLIENT_ID` | same client id (used by the PayPal JS SDK in the browser) |
| `INVOICE_RECIPIENT_EMAIL` | developer.paypal.com → Testing tools → Sandbox accounts → your **Personal** account email |
| `PAYPAL_WEBHOOK_ID` | printed by `pnpm webhook:register` (see below) |
| `PUBLIC_URL` | the public origin, e.g. `https://crankwell.xyz`. Used for OAuth metadata and links from Claude. Optional locally |

The 3D model and parts explorer work without any keys. The chat needs `AGENT_API_KEY`, and checkout needs the PayPal keys. The chat model defaults to `dsv4` (DeepSeek V4) on Boundless; `AGENT_MODEL` and `AGENT_BASE_URL` point it at any other OpenAI-compatible model and endpoint.

### PayPal sandbox walkthrough

1. **Sandbox accounts.** PayPal creates a *Business* account (the merchant behind your app) and a *Personal* account (the buyer). Log in with the Personal account in the PayPal popup during checkout.
2. **Vault (for one-tap).** In the sandbox app's settings, turn on **Save payment methods**. Without it everything still works; Confirm just always goes through PayPal approval.
3. **Webhooks (optional but recommended).** PayPal only delivers webhooks to public HTTPS URLs, so expose your dev server and register the endpoint:
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
| First agent purchase, "Save PayPal" ticked | **Orders v2** + **Vault** | `payment_source.paypal.attributes.vault` with `store_in_vault: ON_SUCCESS`; the capture/authorize response returns the vault id |
| Later agent purchases (one tap) | **Orders v2** with `vault_id` | The order completes server-side with no redirect: captured for parts, authorized (held) for a shop deposit |
| Remove saved PayPal | **Vault v3** | `DELETE /v3/vault/payment-tokens/{id}`; `VAULT.PAYMENT-TOKEN.*` webhooks keep it in sync |
| Live status | **Webhooks** | `/api/paypal/webhook` verifies every event with `verify-webhook-signature`, dedupes by event id, never downgrades state on out-of-order delivery, and pushes updates to the browser over SSE |

Server code: `lib/server/paypal.ts` uses the official `@paypal/paypal-server-sdk` for Orders and Payments. Invoicing and webhook verification aren't in that SDK, so they call the REST API directly with the same OAuth credentials. The browser uses `@paypal/react-paypal-js/sdk-v6`.

## The agent

`lib/agent/` runs a streaming, manual tool loop on Boundless inference (`dsv4`, DeepSeek V4, by default):

- OpenAI-compatible chat completions at `https://api.inference.boundless.network/v1` (`lib/agent/model.ts`)
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
| `prepare_action` | A confirm card for a part, shop deposit or technician visit, priced by the server. Nothing is charged until the user taps |
| `get_orders` | Answers "did my payment go through?" |

The system prompt enforces safety rules. A sinking brake pedal means *do not drive*. Checks are limited to static, engine-idling-in-Park, or walking-pace tests. The agent never asks the user to work under a car on a jack or open a hot radiator.

## Agent checkout: the AI prepares, you tap, PayPal executes

When the user asks the agent (in the app or in Claude) to buy, book or reserve something, it creates an **action**: a proposal priced from the server catalog, never from the model, that expires after 15 minutes. Only a human tap confirms it.

- **No saved PayPal yet:** the card opens PayPal approval with a "Save PayPal so next time it's one tap" box (explicit Vault consent).
- **Saved PayPal:** Confirm is a single tap. The server creates the order with the vault id and PayPal completes it immediately.
- **Technician visits** send a PayPal invoice, so nothing moves until the visit is paid.

Guardrails (`lib/server/actions.ts`): one-tap is capped at $500 per order and $1,000 a day (larger amounts go through PayPal approval); a compare-and-set status change means a double tap can't pay twice; every action is bound to the browser session that owns it.

## Use Crankwell from Claude (MCP connector)

Crankwell is also a remote MCP server at **`/api/mcp`** (Streamable HTTP) with MCP Apps cards.

- **claude.ai / Claude Desktop:** Settings → Connectors → Add custom connector → `https://crankwell.xyz/api/mcp`
- **Claude Code:** `claude mcp add --transport http crankwell https://crankwell.xyz/api/mcp`

Then ask, for example: *"Use Crankwell. My 2017 Civic grinds when I brake and the pedal feels a bit soft. What's wrong, is it safe to drive, and can you get it fixed? I'll pay with PayPal."*

| Tool | Sign-in | What it does |
|---|---|---|
| `find_suspect_parts` | no | Ranks catalog parts against the symptom; maps any car to the closest reference model |
| `get_part_info`, `search_spare_parts`, `find_technicians`, `find_repair_shops` | no | The same catalog and provider lookups the in-app agent uses |
| `show_diagnosis` | no | Diagnosis card: suspects with confidence, a drive-safety banner, and **Open 3D view**, which opens Crankwell with the camera on the suspect parts |
| `show_options` | no | Fix options card (DIY, buy a part, mobile technician, shop, tow); tapping one asks Claude to continue |
| `prepare_purchase` | yes | PayPal checkout card: **Pay · one tap** with saved PayPal, or **Continue to PayPal**, after which the card follows the payment live |
| `get_purchase_status`, `get_orders` | yes | Live PayPal status for the user's orders |

**Sign-in is lazy.** Diagnosis needs no account. The first purchase returns `401` with a `WWW-Authenticate` challenge, Claude shows **Connect**, and the user clicks **Allow** once on Crankwell's consent page. That links Claude to the browser's Crankwell session (OAuth 2.1 with PKCE; Claude identifies itself with a client ID metadata document, and dynamic registration is there for other clients). Claude's purchases then show up in that browser's Orders ledger.

**Claude can't pay on its own.** The card's Pay button calls `confirm_purchase`, which is hidden from the model (`visibility: ["app"]`) and also requires a per-checkout key that's sent only in the tool result's `_meta`, which goes to the card and not to the model. Prices come from the server, and the one-tap caps apply.

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
pnpm test             # vitest: catalog, pricing, agent tools, PayPal state machine, actions + Vault, OAuth, MCP, geometry
pnpm typecheck && pnpm lint && pnpm build
pnpm webhook:register <https-url> [--write]
node scripts/shot.mjs out.png [--theme dark] [--size 390x844] [--js "<code>"]   # headless GPU screenshot (dev)
```

## Project layout

```
app/api/agent            DeepSeek V4 agent via Boundless (SSE stream)
app/api/paypal/*         orders, capture, authorize, deposit capture/void, refunds, invoices, webhook
app/api/events           live transaction updates (SSE)
app/api/actions/*        agent-prepared checkouts: status, one-tap confirm, PayPal approval
app/api/mcp              MCP server for Claude (lazy OAuth gate)
app/api/oauth/*          OAuth 2.1 for the connector: metadata, register, token (consent page: app/oauth/authorize)
app/pay                  checkout page for links from Claude, and the PayPal return
components/scene         R3F canvas, studio, part meshes, camera rig
components/chat          sidebar + diagnosis / safety-test / recommendation cards
components/commerce      PayPal button, parts shop, shop reservation, technician invoice, orders drawer + AG Grid ledger
components/grid          AG Grid theme and module registration
lib/cars                 car specs, part templates (notes + prices), layout generator
lib/three                body surface, materials, procedural textures, part builders
lib/agent                prompt, tools, loop
lib/mcp                  MCP tools and the MCP Apps card (ui://crankwell/card)
lib/server               SQLite, PayPal client, commerce state machine, actions, wallet (Vault), OAuth
```

## Notes

- Shops and technicians are seeded demo data placed around the browser's location (or San Jose, CA by default). They aren't real businesses.
- Prices are typical market estimates, not quotes.
- The agent gives guidance, not a guaranteed diagnosis. Anything safety-critical should be inspected by a qualified mechanic.
