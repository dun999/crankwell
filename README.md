# Crankwell

An AI mechanic built on **DeepSeek V4** (Boundless inference) and **PayPal**. Users explore detailed, procedurally built 3D models of a **Toyota Corolla** (E210, 2.0 L M20A, FWD) and a **Honda CR-V** (1.5 L turbo L15B, AWD). They describe what's wrong in a chat, and the agent:

1. moves the camera to the suspect parts, x-rays the rest of the car, and labels each suspect with its confidence,
2. asks for **safe** checks that tell the suspects apart,
3. updates the diagnosis, then offers a do-it-yourself fix, a spare part, a mobile technician, or a repair-shop reservation,
4. and when you say "buy it" or "book them", **prepares the checkout for you to confirm with one tap**. The AI prepares, you tap, PayPal executes.
5. After the sale it keeps going: it tracks the parts shipment, checks a payment or dispute with PayPal, refunds, checks you in at the shop, settles the technician's job (refunding unused labor and paying the technician), and, within a spending limit you approve, buys parts for you.

The same mechanic works **inside Claude**: add Crankwell as a connector, describe your car's problem, and Claude shows the diagnosis, the fix options and a PayPal checkout card right in the conversation.

Every payment goes through PayPal (sandbox): **Orders v2** (with shipment tracking), **Payments v2** (authorize, reauthorize, capture, void, full and partial refunds), **Vault** (saved PayPal for one-tap), **Invoicing v2**, **Payouts**, **Pay Later**, **Webhooks** (including disputes and reversals), and the **PayPal Agent Toolkit**.

![stack](https://img.shields.io/badge/Next.js-16-black) ![three](https://img.shields.io/badge/three.js-r186-blue) ![deepseek](https://img.shields.io/badge/DeepSeek-V4-4D6BFE) ![paypal](https://img.shields.io/badge/PayPal-sandbox-003087) ![aggrid](https://img.shields.io/badge/AG%20Grid-Enterprise-0E4491)

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
| `AGENT_FALLBACK_API_KEY` | optional backup model, e.g. [openrouter.ai](https://openrouter.ai) → Keys. Used while the primary is down or rate limited |
| `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` | developer.paypal.com → Apps & Credentials → **Sandbox** → your app |
| `NEXT_PUBLIC_PAYPAL_CLIENT_ID` | same client id (used by the PayPal JS SDK in the browser) |
| `INVOICE_RECIPIENT_EMAIL` | developer.paypal.com → Testing tools → Sandbox accounts → your **Personal** account email |
| `PAYOUT_RECEIVER_EMAIL` | a sandbox **Business** account that stands in for the technicians (receives their Payouts) |
| `PAYPAL_WEBHOOK_ID` | printed by `pnpm webhook:register` (see below) |
| `PUBLIC_URL` | the public origin, e.g. `https://crankwell.xyz`. Used for OAuth metadata and links from Claude. Optional locally |
| `NEXT_PUBLIC_AG_GRID_LICENSE` | AG Grid Enterprise key. Without it every grid feature works, with a watermark |

The 3D model and parts explorer work without any keys. The chat needs `AGENT_API_KEY`, and checkout needs the PayPal keys. The chat model defaults to `dsv4` (DeepSeek V4) on Boundless; `AGENT_MODEL` and `AGENT_BASE_URL` point it at any other OpenAI-compatible model and endpoint. `.env.example` lists every option.

### PayPal sandbox walkthrough

1. **Sandbox accounts.** PayPal creates a *Business* account (the merchant behind your app) and a *Personal* account (the buyer). Log in with the Personal account in the PayPal popup during checkout. Add a second *Business* account for `PAYOUT_RECEIVER_EMAIL`, and a **US** *Personal* account to see Pay Later (PayPal offers it by buyer country).
2. **App features.** In the sandbox app's settings, turn on **Save payment methods** (Vault, for one-tap) and **Payouts**. Without them everything else still works: Confirm goes through PayPal approval each time, and finished jobs skip the technician payout.
3. **Webhooks (optional but recommended).** PayPal only delivers webhooks to public HTTPS URLs, so expose your dev server and register the endpoint:
   ```bash
   pnpm dlx cloudflared tunnel --url http://localhost:3000     # prints https://<name>.trycloudflare.com
   pnpm webhook:register https://<name>.trycloudflare.com --write
   # restart `pnpm dev` so PAYPAL_WEBHOOK_ID is picked up
   ```
   Without webhooks everything still works: the server updates orders from the API responses, and a background reconciler checks PayPal for anything left open (see *Staying in line with PayPal*). Webhooks add live push updates. For example, the technician booking confirms itself when the buyer pays the invoice.

## What PayPal does where

| User action | PayPal API | Flow |
|---|---|---|
| Buy a spare part | **Orders v2** `intent=CAPTURE` | Server prices the order from the catalog (the client never sends prices) → buyer approves in the JS SDK v6 popup → server captures |
| Pay in installments | **Pay Later** | Pay Later button and "Pay in 4" messaging on part orders of $30–$1,500, for eligible buyers; same order and capture |
| Parts ship | **Orders v2** tracking | `POST /v2/checkout/orders/{id}/track` adds a tracker to the capture (sandbox carrier and number); the receipt shows it |
| Cancel a part order | **Payments v2** refund | `POST /v2/payments/captures/{id}/refund` |
| Reserve a repair shop slot | **Orders v2** `intent=AUTHORIZE` | A refundable diagnostic deposit is *held*, not charged |
| Check in / cancel the reservation | **Payments v2** | Capture the authorization at check-in (reauthorized first if PayPal's 3-day honor period has passed), or void it on cancel |
| Book a mobile technician | **Invoicing v2** | Generate number → create draft → send → buyer pays on PayPal's hosted invoice page. Reminders via the Agent Toolkit |
| Technician's job done | **Payments v2** partial refund + **Payouts** | Unused estimated labor is refunded on the invoice's payment; the technician's 85% share goes out with `POST /v1/payments/payouts` (idempotent batch id), tracked by `PAYMENT.PAYOUTS-ITEM.*` webhooks |
| First agent purchase, "Save PayPal" ticked | **Orders v2** + **Vault** | `payment_source.paypal.attributes.vault` with `store_in_vault: ON_SUCCESS`; the capture/authorize response returns the vault id |
| Later agent purchases (one tap, or within a spending limit) | **Orders v2** with `vault_id` | The order completes server-side with no redirect: captured for parts, authorized (held) for a shop deposit |
| Remove saved PayPal | **Vault v3** | `DELETE /v3/vault/payment-tokens/{id}`; `VAULT.PAYMENT-TOKEN.*` webhooks keep it in sync. Ends any spending limits |
| "Did it ship?", "is there a dispute?" | **PayPal Agent Toolkit** | `get_order`, `get_invoice`, `list_disputes`, `get_dispute`, scoped to the user's own orders (see below) |
| Disputes and reversals | **Webhooks** | `CUSTOMER.DISPUTE.*` and `PAYMENT.CAPTURE.REVERSED` show on the order and in the agent's answers |
| Live status | **Webhooks** | `/api/paypal/webhook` verifies every event with `verify-webhook-signature`, dedupes by event id, never downgrades state on out-of-order delivery, and pushes updates to the browser over SSE |

Server code: `lib/server/paypal.ts` uses the official `@paypal/paypal-server-sdk` for Orders and Payments. Invoicing, tracking, Payouts and webhook verification aren't in that SDK, so they call the REST API directly with the same OAuth credentials. The browser uses `@paypal/react-paypal-js/sdk-v6`.

### Staying in line with PayPal

- **Webhook-driven completion.** `CHECKOUT.ORDER.APPROVED` captures or authorizes the order even if the buyer closes the tab after approving (idempotent `PayPal-Request-Id`s, so the browser and the webhook can't double-capture).
- **Reconciler** (`lib/server/reconcile.ts`, started from `instrumentation.ts`, every 2 minutes): re-reads orders left open with PayPal, unsticks checkouts that stopped mid-confirm, re-checks unpaid invoices, ships paid parts orders, and follows payouts until they're final. `RECONCILER=off` turns it off.
- **PayPal is the source of truth for the agent.** `get_orders` re-reads open orders from PayPal before answering, and says whether each status is `live`, `final` or the last one known.

## The agent

`lib/agent/` runs a streaming, manual tool loop on Boundless inference (`dsv4`, DeepSeek V4, by default):

- OpenAI-compatible chat completions (`lib/agent/model.ts`), with **failover** to a backup provider (`AGENT_FALLBACK_*`, e.g. DeepSeek on OpenRouter). A provider that fails before streaming (auth, budget, rate limit, 5xx, network) sits out for 5 minutes. If every provider is down, the chat still answers with a keyword match against the catalog, labeled as such, with safety advice.
- a daily token budget (`AGENT_DAILY_TOKEN_BUDGET`), per-IP rate limits, and a trace per turn (provider, latency, tokens, every tool call) shown under the reply and stored in SQLite
- reasoning notes, when the model sends them, show as status lines in the chat and are replayed on later tool turns (DeepSeek requires `reasoning_content`)
- history kept server-side in SQLite; the last 4 turns go in verbatim, older ones are condensed to their text
- every tool input checked with zod; invalid input is returned to the model so it can correct itself

| Tool | Effect in the UI |
|---|---|
| `show_diagnosis` | Camera flies to the suspects, other systems are ghosted, confidence labels appear, and a diagnosis card with drive-safety guidance |
| `focus_parts` | Points the camera at parts (switches car if needed) |
| `request_safety_tests` | Checklist card. The user taps answers, which go back to the agent |
| `get_part_info`, `search_spare_parts`, `show_parts` | Catalog lookups (purpose, typical price, DIY difficulty, SKUs) and parts with Buy buttons |
| `find_repair_shops`, `find_technicians` | Seeded demo providers near the user's location, with real upcoming slots |
| `recommend_actions`, `suggest_replies` | Option cards with built-in PayPal checkout, and reply chips |
| `prepare_action` | A confirm card for a part, shop deposit or technician visit, priced by the server. Nothing is charged until the user taps |
| `get_orders` | "Did my payment go through?", answered from PayPal |
| `prepare_order_change` | A confirm card for an after-sale change: refund, check in, cancel the reservation, remind or cancel the invoice, mark the job done |
| `paypal_lookup` | Asks PayPal through the Agent Toolkit about one of the user's orders: payment, tracking or dispute |
| `propose_mandate`, `buy_within_mandate`, `revoke_mandates` | Spending limits (in-app only, see below) |

The system prompt enforces safety rules. A sinking brake pedal, steam, a fuel leak, smoke, a flashing check-engine light with shaking, an oil-pressure knock, exhaust in the cabin, loose or wandering steering, a wobbling wheel or a tire bulge means *do not drive*. Checks are limited to static, engine-idling-in-Park, or walking-pace tests. The agent never asks the user to work under a car on a jack or open a hot radiator.

### Measured: a 41-scenario eval

`pnpm eval` runs the in-app agent against 41 scenarios (11 safety-critical, 25 everyday problems across both cars, 5 adversarial) and scores it deterministically, with no model grading a model. Latest run on DeepSeek V4 ([docs/eval.md](docs/eval.md)):

| | |
|---|---|
| Scenarios passed | 41/41 |
| Don't-drive recall on safety-critical cases | 100% |
| Right part ranked first / in the top 3 | 100% / 100% |
| Don't-drive on an everyday problem (over-caution) | 0% |
| Unsafe instructions, false "it's paid" claims, payments without a tap, leaked secrets | 0 |
| Adversarial (injection, "charge me without a card", "I already paid", secrets) | 5/5 |

The first run scored 38/41: loose, wandering steering got "caution". The eval led to an explicit do-not-drive list in the safety rules, which Claude gets too. `docs/eval.json` has every reply.

## Agent checkout: the AI prepares, you tap, PayPal executes

When the user asks the agent (in the app or in Claude) to buy, book or reserve something, it creates an **action**: a proposal priced from the server catalog, never from the model, that expires after 15 minutes. Only a human tap confirms it.

- **No saved PayPal yet:** the card opens PayPal approval with a "Save PayPal so next time it's one tap" box (explicit Vault consent).
- **Saved PayPal:** Confirm is a single tap. The server creates the order with the vault id and PayPal completes it immediately.
- **Technician visits** send a PayPal invoice, so nothing moves until the visit is paid.

Guardrails (`lib/server/actions.ts`): one-tap is capped at $500 per order and $1,000 a day (larger amounts go through PayPal approval); a compare-and-set status change means a double tap can't pay twice; every action is bound to the browser session that owns it.

**After the sale** the same pattern applies: `prepare_order_change` shows a card with what will happen and the amount (**Confirm refund**, **Check in · capture deposit**, **Job done · settle with PayPal**, …), and only the tap runs it. Which changes are possible comes from one table (`lib/commerce/ops.ts`) shared by the agent, the Orders panel and the MCP server.

**Spending limits** (`lib/server/mandates.ts`, in-app agent only). The mechanic can ask once: "Let me buy brake and suspension parts for your Corolla, up to $150 an order and $300 in total, for 7 days". Nothing changes until the user taps **Allow** on that card. Within the limit it can then buy with the saved PayPal without a card per purchase:

- The approved terms (car, systems, per-order and total limit, expiry) are signed with a server HMAC and checked on every purchase.
- The spend is reserved with one conditional `UPDATE`, so two purchases can't both use the last of a limit, and released if PayPal declines.
- Every purchase gets a receipt labeled "Bought by the mechanic within your spending limit" with **Undo · refund**. A refunded purchase gives its amount back to the limit, and the card updates live.
- Limits can be revoked from the card, from the Orders panel or by asking; removing saved PayPal ends them all. Claude over MCP never gets these tools.

### PayPal Agent Toolkit, scoped to the user

`@paypal/agent-toolkit` acts on the whole merchant account (any order, any dispute), so its tools are never handed to the customer-facing model as-is. `lib/server/paypal-toolkit.ts` enables only `get_order`, `get_invoice`, `list_disputes`, `get_dispute` and `send_invoice_reminder`. The agent's `paypal_lookup` takes an `order_ref`, checks that the order belongs to the session, and only then runs the toolkit with that order's PayPal ids. Sending an invoice reminder is an order change, so it needs the user's tap. (The toolkit's `get_shipment_tracking` uses PayPal's legacy tracking API, which returns 403 for this app, so tracking is read from the order.)

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
| `prepare_order_change` | yes | Card for a refund, check-in, cancellation, invoice reminder or job completion; runs on the user's tap |
| `paypal_lookup` | yes | Payment, tracking or dispute for one of the user's orders, via the PayPal Agent Toolkit |

**Sign-in is lazy.** Diagnosis needs no account. The first purchase returns `401` with a `WWW-Authenticate` challenge, Claude shows **Connect**, and the user clicks **Allow** once on Crankwell's consent page. That links Claude to the browser's Crankwell session (OAuth 2.1 with PKCE; Claude identifies itself with a client ID metadata document, and dynamic registration is there for other clients). Claude's purchases then show up in that browser's Orders ledger.

**Claude can't pay on its own.** The card's Pay button calls `confirm_purchase`, which is hidden from the model (`visibility: ["app"]`) and also requires a per-checkout key that's sent only in the tool result's `_meta`, which goes to the card and not to the model. Prices come from the server, and the one-tap caps apply.

## Sessions and security

- The browser session is an **httpOnly, SameSite=Lax cookie** (`cw_sid`, 32 random bytes) set by `proxy.ts`. It never travels in URLs or request bodies, and every state-changing request must come from the app's own origin. Sessions from the older localStorage scheme are adopted once.
- Everything a session owns (chat, orders, saved PayPal, spending limits, actions) is checked against it on the server; the agent's tools take an `order_ref` and can't reach another session's orders.
- Prices always come from the server catalog. Webhooks are signature-verified. Per-IP rate limits cover the agent, checkout, OAuth and MCP.
- **`/api/health`** reports the database, PayPal (token, webhook, last webhook, reconciler), and each AI provider with today's token use; `?deep=1` also pings each provider. Point an uptime monitor at it.

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

Two views use AG Grid Enterprise (`ag-grid-enterprise` + `ag-grid-react` v36). Both load only when opened, so they add nothing to the first page load.

**Ask, in words.** Both grids have an Ask box. The grid describes itself with the **AI Toolkit** (`api.getStructuredSchema()`: its columns, filter types, set values, what can be grouped and aggregated), and `/api/grid/query` has the model answer with grid state in that schema. The server keeps only filter, sort, grouping and aggregation on the grid's own columns; the browser applies it with `api.setState()` without touching the column layout, and follow-up questions build on the current view. For example, "brake parts I can do myself under $100, cheapest first" sets a set filter on system, number filters on DIY difficulty and price, and a sort. "What did I spend on the Corolla, by type" groups the ledger with a sum.

- **Price guide** (`components/hud/PriceGuide.tsx`): every part of the car on screen with part price, shop labor, typical repair total, DIY difficulty and lifespan. Price columns show ranges but filter, sort and average on the typical price. Quick filter searches names *and* failure symptoms ("brake light out" finds the tail lamps); an external filter narrows by system or to parts sold in the store; Ask can also group by system with averages. The grid drives the 3D view: hovering a row outlines that part on the car, clicking flies the camera to it and opens its details, and selecting a part anywhere else (3D click, search, the agent's diagnosis) selects and scrolls to its row.
- **Orders ledger** (`components/commerce/OrdersLedger.tsx`): every PayPal order, shop deposit and invoice with live status (webhook-pushed rows are marked, and changed cells flash) and the current PayPal reference.
  - Each row expands (**master/detail**) into its money flow: line items, the capture or hold, refunds, the technician's payout and its fee, each with its PayPal id.
  - **Set filters** on status, type and car, and date filters.
  - **Grouping** with a summed amount.
  - A **pinned total** over the rows shown: what was paid after refunds, so refunded orders, released holds and cancelled invoices add nothing.
  - **CSV export**.
  - Selecting a row opens its timeline and the actions PayPal allows next.

The theme (`components/grid/theme.ts`) is Quartz with the app's CSS variables, so the grids follow light and dark mode, and registers only the modules the two grids use. Columns adapt to the grid's width, down to part + total on a phone.

## Scripts

```bash
pnpm test             # vitest: catalog, pricing, agent tools, PayPal state machine, actions + Vault, after-sale changes,
                      # fulfilment + Payouts, Agent Toolkit scoping, spending limits, reconciler, failover, OAuth, MCP, grid Ask, eval scoring
pnpm typecheck && pnpm lint && pnpm build
pnpm eval [--only id,id] [--provider fallback]   # the 41-scenario agent eval → docs/eval.md
pnpm webhook:register <https-url> [--write]
pnpm qa:ui <url> [out-dir]   # headless UI checks across themes and sizes, APIs mocked (findings: docs/ui-qa.md)
pnpm perf <url>              # load and frame timing against a production server (results: docs/performance.md)
node scripts/shot.mjs out.png [--theme dark] [--size 390x844] [--js "<code>"]   # headless GPU screenshot (dev)
```

## Project layout

```
app/api/agent            DeepSeek V4 agent via Boundless, with failover (SSE stream)
app/api/paypal/*         orders, capture, authorize, deposit capture/void, refunds, invoices (+ remind, job done), webhook
app/api/events           live transaction updates (SSE)
app/api/actions/*        agent-prepared checkouts and order changes: status, one-tap confirm, PayPal approval
app/api/mandates         spending limits: list, approve, revoke
app/api/grid/query       Ask for the AG Grid tables
app/api/health           health for uptime monitors
app/api/mcp              MCP server for Claude (lazy OAuth gate)
app/api/oauth/*          OAuth 2.1 for the connector: metadata, register, token (consent page: app/oauth/authorize)
app/pay                  checkout page for links from Claude, and the PayPal return
components/scene         R3F canvas, studio, part meshes, camera rig
components/chat          sidebar + diagnosis / safety-test / recommendation / checkout / spending-limit cards
components/commerce      PayPal and Pay Later buttons, parts shop, shop reservation, technician invoice, orders drawer + AG Grid ledger
components/grid          AG Grid theme, module registration, Ask box
evals                    eval scenarios and deterministic scoring
lib/cars                 car specs, part templates (notes + prices), layout generator
lib/three                body surface, materials, procedural textures, part builders
lib/agent                prompt, tools, loop, provider failover
lib/mcp                  MCP tools and the MCP Apps card (ui://crankwell/card)
lib/server               SQLite, PayPal client, Agent Toolkit, commerce state machine, reconciler, actions, mandates, wallet (Vault), OAuth
```

## Notes

- Shops and technicians are seeded demo data placed around the browser's location (or San Jose, CA by default). They aren't real businesses. Parts "ship" with a sandbox carrier.
- Prices are typical market estimates, not quotes.
- The agent gives guidance, not a guaranteed diagnosis. Anything safety-critical should be inspected by a qualified mechanic.

## License

[MIT](LICENSE). Third-party packages keep their own licenses; AG Grid Enterprise runs here without a license key (trial watermark).
