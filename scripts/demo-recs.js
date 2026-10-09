// Injects a scripted recommendations card (as emitted by the agent's recommend_actions tool).
(() => {
  const recs = {
    type: "recommendations", carId: "corolla", headline: "Your options for the brake leak",
    actions: [
      { type: "book_technician", title: "Have a mobile mechanic inspect and bleed the brakes", why: "The car shouldn't be driven. A technician can find the leak, replace the master cylinder if needed and bleed the system in your driveway.", urgency: "now", part: { id: "brakes.master_cylinder", name: "Brake master cylinder" }, estCost: { min: 250, max: 480 },
        technician: { id: "tech_lin", name: "Lin Chen", initials: "LC", skills: ["brakes"], rating: 4.9, jobs: 801, calloutFee: 65, hourlyRate: 110, etaMinutes: 90, certified: "ASE A5 Brakes, Toyota & Honda trained" } },
      { type: "buy_part", title: "Order an OE-spec master cylinder", why: "If the technician confirms the master cylinder, having the part on hand saves a second visit.", urgency: "soon", part: { id: "brakes.master_cylinder", name: "Brake master cylinder" },
        skus: [
          { sku: "FYC-COROLLA-MASTER_CYLINDER-V", carId: "corolla", partId: "brakes.master_cylinder", template: "master_cylinder", name: "RoadReady Brake master cylinder", tier: "Value", brand: "RoadReady", price: 89.99, warranty: "1 year", inStock: true, shipDays: 4 },
          { sku: "FYC-COROLLA-MASTER_CYLINDER-O", carId: "corolla", partId: "brakes.master_cylinder", template: "master_cylinder", name: "OEM-Spec Brake master cylinder", tier: "OE-Equivalent", brand: "OEM-Spec", price: 174.99, warranty: "2 years", inStock: true, shipDays: 3 },
          { sku: "FYC-COROLLA-MASTER_CYLINDER-P", carId: "corolla", partId: "brakes.master_cylinder", template: "master_cylinder", name: "Apex Pro Brake master cylinder", tier: "Performance", brand: "Apex Pro", price: 259.99, warranty: "Limited lifetime", inStock: true, shipDays: 2 } ] },
      { type: "reserve_shop", title: "Tow to a brake specialist", why: "Prefer a shop? They'll pressure-test the system on a lift.", urgency: "soon", estCost: { min: 220, max: 520 },
        shop: { id: "shop_precision_brake", name: "Precision Brake & Alignment", specialties: ["brakes"], rating: 4.8, reviews: 412, distanceKm: 2.1, address: "100 Market St", hours: "Mon–Sat 8–6", laborRate: 135, deposit: 25, nextSlots: ["Today 3:30 PM", "Tomorrow 8:00 AM", "Tomorrow 1:00 PM"], lat: 0, lng: 0 } },
    ],
  };
  const st = window.__chat.getState();
  window.__chat.setState({ messages: [...st.messages,
    { id: "u2", role: "user", blocks: [{ kind: "text", text: "Here are my safety test results:\n- Fluid: At or below MIN\n- Pedal hold: Slowly sinks\n- Wet spots: All dry" }] },
    { id: "a2", role: "assistant", blocks: [ { kind: "text", text: "Low fluid with **no wet wheels** and a **slowly sinking pedal** points strongly at the master cylinder leaking internally into the booster." }, { kind: "ui", event: recs } ] } ] });
  return "ok";
})();
