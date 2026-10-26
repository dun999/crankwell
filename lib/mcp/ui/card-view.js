// Crankwell's MCP App view: one card that renders show_diagnosis, show_options and prepare_purchase
// results inside Claude. Plain browser JS, inlined into the ui://crankwell/card resource after the
// ext-apps bundle (which exposes globalThis.__crankwellExt). All data goes in through textContent.

const { App, applyDocumentTheme, applyHostStyleVariables, applyHostFonts } = globalThis.__crankwellExt;
const app = new App({ name: "Crankwell", version: "1.0.0" }, {}, { autoResize: true });
const root = document.getElementById("root");

const ICONS = {
  diy: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
  buy_part:
    '<path d="m7.5 4.27 9 5.15"/><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/>',
  book_technician: '<circle cx="12" cy="8" r="5"/><path d="M20 21a8 8 0 0 0-16 0"/>',
  reserve_shop: '<rect width="16" height="20" x="4" y="2" rx="2"/><path d="M9 22v-4h6v4"/><path d="M8 6h.01M16 6h.01M12 6h.01M12 10h.01M12 14h.01M16 10h.01M16 14h.01M8 10h.01M8 14h.01"/>',
  tow: '<path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/><path d="M15 18H9"/><path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 17.52 8H14"/><circle cx="17" cy="18" r="2"/><circle cx="7" cy="18" r="2"/>',
  shield:
    '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="M12 8v4"/><path d="M12 16h.01"/>',
  check: '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
  link: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3"/>',
  zap: '<path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/>',
  lock: '<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  cube: '<path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/>',
};

/** Tiny element builder: h("div", { class: "x", onclick }, "text", child). Strings become text nodes. */
function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v == null || v === false) continue;
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "class") el.className = v;
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  for (const c of children.flat()) if (c != null && c !== false) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
}
function icon(name, cls = "ic") {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("class", cls);
  svg.innerHTML = ICONS[name] ?? ""; // static, trusted markup
  return svg;
}
const money = (s) => `$${Number(s).toFixed(2)}`;
const eyebrow = (label, extra) => h("div", { class: "eyebrow" }, h("span", { class: "brand" }, "Crankwell"), h("span", null, "·"), h("span", null, label), extra ? h("span", { class: "grow" }) : null, extra);
const textOf = (r) => (r?.content ?? []).filter((c) => c.type === "text").map((c) => c.text).join("\n");

async function open(url) {
  try {
    const r = await app.openLink({ url });
    if (r?.isError) window.open(url, "_blank", "noopener");
  } catch {
    window.open(url, "_blank", "noopener");
  }
}
function say(text) {
  return app.sendMessage({ role: "user", content: [{ type: "text", text }] }).catch(() => {});
}

// ───────────────────────── diagnosis ─────────────────────────

const SAFETY = {
  do_not_drive: ["danger", "Don't drive it", "Have it towed, or book a mobile mechanic to come to you."],
  caution: ["warning", "Drive with caution", "Short, gentle trips only until it's checked."],
  safe: ["success", "Safe to drive", "Keep an eye on it and fix it soon."],
};

function diagnosis(d) {
  const [tone, head, body] = SAFETY[d.drive_safety] ?? SAFETY.caution;
  const suspects = d.suspects.slice(0, 4);
  return h(
    "section",
    { class: "stack" },
    eyebrow("Diagnosis", h("span", { class: `chip ${d.severity}` }, `${d.severity[0].toUpperCase()}${d.severity.slice(1)} severity`)),
    h("div", null, h("h2", null, d.title), h("p", { class: "sub" }, d.vehicle ?? d.reference_model, d.reference_note ? h("span", { class: "faint" }, ` · ${d.reference_note}`) : null)),
    h("div", { class: `banner ${tone}`, role: "status" }, icon("shield"), h("div", null, h("strong", null, head), h("span", null, body))),
    h(
      "ol",
      { class: "suspects", "aria-label": "Most likely causes" },
      suspects.map((s) => {
        const pct = Math.round(s.confidence * 100);
        return h(
          "li",
          null,
          h("div", { class: "row" }, h("span", { class: "name" }, s.name), h("span", { class: "pct" }, `${pct}%`)),
          h("div", { class: "bar", role: "img", "aria-label": `${pct}% likely` }, h("i", { style: `width:${Math.max(4, pct)}%` })),
          h("p", { class: "why" }, s.rationale),
        );
      }),
    ),
    h(
      "div",
      { class: "actions" },
      h("button", { class: "btn", onclick: () => open(d.case_url) }, icon("cube"), "Open 3D view"),
      h("button", { class: "btn primary", onclick: (e) => { e.currentTarget.disabled = true; say("What are my options to fix this? Include what I can do myself and who can do it for me."); } }, "See fix options"),
    ),
  );
}

// ───────────────────────── options ─────────────────────────

const ASK = {
  diy: (o) => `Walk me through the DIY fix: ${o.title}.`,
  buy_part: (o) => `Let's go with "${o.title}". Prepare the PayPal checkout.`,
  book_technician: (o) => `Book "${o.title}". Prepare the PayPal checkout.`,
  reserve_shop: (o) => `Reserve "${o.title}". Prepare the PayPal checkout.`,
  tow: (o) => `Help me arrange this: ${o.title}.`,
};
const URGENCY = { now: "Do this now", soon: "Soon", when_convenient: "When convenient" };

function options(o) {
  let chosen = null;
  const list = h("ul", { class: "options" });
  const draw = () =>
    list.replaceChildren(
      ...o.options.slice(0, 4).map((x, i) =>
        h(
          "li",
          { class: chosen === i ? "chosen" : "" },
          h("span", { class: "tile" }, icon(x.type)),
          h(
            "div",
            { class: "body" },
            h("div", { class: "title" }, x.title),
            h("div", { class: "meta" }, [x.price, x.who, URGENCY[x.urgency]].filter(Boolean).join(" · ")),
            h("p", { class: "why" }, x.why),
          ),
          h(
            "button",
            {
              class: "btn small",
              disabled: chosen != null,
              "aria-label": `Choose ${x.title}`,
              onclick: () => {
                chosen = i;
                draw();
                say(ASK[x.type]?.(x) ?? `Let's do: ${x.title}.`);
              },
            },
            chosen === i ? "Sent" : "Choose",
          ),
        ),
      ),
    );
  draw();
  return h(
    "section",
    { class: "stack" },
    eyebrow("Ways to fix it", o.case_url ? h("button", { class: "link", onclick: () => open(o.case_url) }, icon("cube", "ic sm"), "3D view") : null),
    h("h2", null, o.headline),
    list,
  );
}

// ───────────────────────── checkout ─────────────────────────

const TOTAL_LABEL = {
  parts: "Total",
  shop_deposit: "Held today",
  technician_invoice: "Invoice total",
  refund: "Refund",
  check_in: "Charged now",
  cancel_reservation: "Released",
  cancel_invoice: "Not charged",
  complete_job: "Back to you",
};
const PAID = {
  parts: "Paid with PayPal",
  shop_deposit: "Deposit held with PayPal",
  technician_invoice: "PayPal invoice sent",
  refund: "Refunded with PayPal",
  check_in: "Deposit captured with PayPal",
  cancel_reservation: "Hold released",
  cancel_invoice: "PayPal invoice cancelled",
  complete_job: "Job settled with PayPal",
};
/** Changes to an existing order (refund, check-in, cancel) rather than a purchase. */
const CHANGE_BUTTON = {
  refund: "Confirm refund",
  check_in: "Check in · capture deposit",
  cancel_reservation: "Cancel reservation · release hold",
  cancel_invoice: "Cancel PayPal invoice",
  complete_job: "Job done · settle with PayPal",
};
const isChange = (kind) => kind in CHANGE_BUTTON;
/** The line under the paid banner: what happens next plus the PayPal reference. */
function paidDetail(kind, p) {
  if (kind === "refund") return ["Back to the original PayPal payment", p?.refund_id && `refund ${p.refund_id}`];
  if (kind === "check_in") return ["Captured at check-in", p?.capture_id && `capture ${p.capture_id}`];
  if (kind === "cancel_reservation") return ["Nothing was charged", p?.authorization_id && `authorization ${p.authorization_id}`];
  if (kind === "cancel_invoice") return ["Nothing was charged", p?.invoice_id && `invoice ${p.invoice_id}`];
  if (kind === "complete_job") return ["Unused labor refunded · technician paid with PayPal Payouts", p?.payout_batch_id && `payout ${p.payout_batch_id}`];
  if (kind === "technician_invoice") return ["Pay the invoice to confirm the visit", p?.invoice_id && `invoice ${p.invoice_id}`];
  if (kind === "shop_deposit") return ["Held, not charged, until check-in", p?.authorization_id && `authorization ${p.authorization_id}`];
  return ["Refundable from Orders", p?.capture_id && `capture ${p.capture_id}`];
}

function checkout(initial, confirmKey) {
  let c = initial;
  let busy = false;
  let err = null;
  let waiting = false;
  let timer = null;
  let announced = false;
  const node = h("section", { class: "stack" });

  const stop = () => {
    clearInterval(timer);
    timer = null;
    waiting = false;
  };
  async function refresh() {
    try {
      const r = await app.callServerTool({ name: "get_purchase_status", arguments: { action_id: c.action.id } });
      if (r.isError) throw new Error(textOf(r));
      update(r.structuredContent);
    } catch (e) {
      // A lost connection shouldn't wipe the card; keep polling quietly.
      if (!timer) err = e.message;
      draw();
    }
  }
  function update(next) {
    if (!next?.action) return;
    const was = c.action.status;
    c = { ...c, ...next };
    if (c.action.status !== "pending") stop();
    if (was !== "confirmed" && c.action.status === "confirmed" && !announced) {
      announced = true;
      const id = (c.action.kind === "refund" && c.paypal?.refund_id) || (c.paypal?.capture_id ?? c.paypal?.authorization_id ?? c.paypal?.invoice_id);
      app
        .updateModelContext({
          content: [{ type: "text", text: `The user ${isChange(c.action.kind) ? "confirmed" : "completed the Crankwell checkout"} "${c.action.title}" (${money(c.action.amount)}). ${c.message ?? ""}${id ? ` PayPal id ${id}.` : ""}` }],
        })
        .catch(() => {});
    }
    draw();
  }
  function poll() {
    waiting = true;
    const until = Date.now() + 10 * 60_000;
    clearInterval(timer);
    timer = setInterval(() => (Date.now() > until ? (stop(), draw()) : refresh()), 3000);
    draw();
  }
  async function pay() {
    busy = true;
    err = null;
    draw();
    try {
      const r = await app.callServerTool({ name: "confirm_purchase", arguments: { action_id: c.action.id, confirm_key: confirmKey } });
      if (r.isError) throw new Error(textOf(r));
      update(r.structuredContent);
    } catch (e) {
      err = e.message;
    } finally {
      busy = false;
      draw();
    }
  }
  async function continueOnPayPal() {
    await open(c.pay_url);
    poll();
  }
  document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && waiting && refresh());

  function draw() {
    const a = c.action;
    const status = a.status;
    const minutesLeft = Math.max(0, Math.round((Date.parse(a.expires_at) - Date.now()) / 60_000));
    const canTap = c.one_tap && confirmKey;
    let footer;
    if (status === "confirmed") {
      footer = [
        h("div", { class: "banner success", role: "status" }, icon("check"), h("div", null, h("strong", null, PAID[a.kind]), h("span", null, paidDetail(a.kind, c.paypal).filter(Boolean).join(" · PayPal ")))),
        h("div", { class: "actions" }, h("button", { class: "btn", onclick: () => open(c.case_url ?? c.pay_url) }, icon("link"), "View in Crankwell")),
      ];
    } else if (status === "expired" || status === "cancelled") {
      footer = h(
        "p",
        { class: "note" },
        isChange(a.kind) ? "Closed. The order is unchanged." : status === "expired" ? "This checkout expired after 15 minutes. Nothing was charged. Ask me to prepare it again." : "Cancelled. Nothing was charged.",
      );
    } else {
      const label = isChange(a.kind) ? CHANGE_BUTTON[a.kind] : a.kind === "technician_invoice" ? "Book · send PayPal invoice" : `Pay ${money(a.amount)} · one tap`;
      footer = [
        canTap
          ? h("button", { class: "btn primary wide", disabled: busy, onclick: pay }, icon("zap"), busy ? "Confirming with PayPal…" : label)
          : h(
              "button",
              { class: "btn primary wide", disabled: busy, onclick: continueOnPayPal },
              waiting ? "Open PayPal again" : isChange(a.kind) ? "Confirm in Crankwell" : a.kind === "technician_invoice" ? "Add invoice email & book" : "Continue to PayPal",
            ),
        h(
          "p",
          { class: "note" },
          waiting
            ? h("span", { class: "pulse" }, "Waiting for PayPal approval…")
            : canTap
              ? isChange(a.kind)
                ? "Done with PayPal right away. Nothing changes until you tap."
                : a.kind === "technician_invoice"
                  ? "Sends the invoice from PayPal. Nothing is charged until you pay it."
                  : "With your saved PayPal. Nothing else to approve."
              : (c.one_tap_note ?? "Approve with your PayPal account on Crankwell. Save PayPal there to make the next one a single tap."),
          minutesLeft ? h("span", { class: "faint" }, ` · expires in ${minutesLeft} min`) : null,
        ),
      ];
    }
    // replaceChildren doesn't flatten arrays or skip nulls the way h() does.
    const parts = [
      eyebrow(isChange(a.kind) ? "Change to your order" : "Checkout", h("span", { class: "paypal" }, "PayPal")),
      h("div", null, h("h2", null, a.title), h("p", { class: "sub" }, a.summary)),
      h(
        "dl",
        { class: "lines" },
        a.lines.map((l) => h("div", null, h("dt", null, l.label), h("dd", null, money(l.amount)))),
        h("div", { class: "total" }, h("dt", null, TOTAL_LABEL[a.kind] ?? "Total"), h("dd", null, money(a.amount))),
      ),
      h("p", { class: "policy" }, icon("lock", "ic sm"), a.policy),
      footer,
      err || a.error ? h("p", { class: "error", role: "alert" }, err ?? a.error) : null,
    ];
    node.replaceChildren(...parts.flat().filter(Boolean));
  }
  draw();
  // The card can be re-rendered from history, so ask where it stands now.
  if (c.action.status === "pending") refresh();
  return node;
}

// ───────────────────────── wiring ─────────────────────────

function render(result) {
  const sc = result?.structuredContent;
  if (result?.isError || !sc?.view) {
    root.replaceChildren(h("section", { class: "stack" }, eyebrow("Crankwell"), h("p", { class: result?.isError ? "error" : "note" }, textOf(result) || "Nothing to show.")));
    return;
  }
  const view = sc.view === "diagnosis" ? diagnosis(sc) : sc.view === "options" ? options(sc) : sc.view === "checkout" ? checkout(sc, result._meta?.["crankwell/confirmKey"]) : null;
  root.replaceChildren(view ?? h("p", { class: "note" }, textOf(result)));
}

function applyContext(ctx) {
  if (!ctx) return;
  if (ctx.theme) applyDocumentTheme(ctx.theme);
  if (ctx.styles?.variables) applyHostStyleVariables(ctx.styles.variables);
  if (ctx.styles?.css?.fonts) applyHostFonts(ctx.styles.css.fonts);
  const s = ctx.safeAreaInsets;
  if (s) document.body.style.padding = `${s.top}px ${s.right}px ${s.bottom}px ${s.left}px`;
}

app.addEventListener("toolresult", render);
app.addEventListener("toolcancelled", () => root.replaceChildren(h("p", { class: "note" }, "Cancelled.")));
app.addEventListener("hostcontextchanged", () => applyContext(app.getHostContext()));
await app.connect();
applyContext(app.getHostContext());
