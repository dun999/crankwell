// Injects a scripted brake diagnosis (the same UI events the agent emits) for visual testing.
(() => {
  const diag = {
    type: "diagnosis", carId: "corolla", title: "Soft, sinking brake pedal", severity: "high", driveSafety: "do_not_drive",
    summary: "A pedal that feels soft and sinks usually means air or a leak in the hydraulic system, or a worn master cylinder seal. Low fluid would point to a leak or very worn pads.",
    suspects: [
      { partId: "brakes.master_cylinder", name: "Brake master cylinder", system: "brakes", confidence: 0.38, rationale: "Internal seal bypass makes the pedal sink slowly while held." },
      { partId: "brakes.lines", name: "Brake lines & hoses", system: "brakes", confidence: 0.27, rationale: "A leaking line or hose lets fluid escape under pressure." },
      { partId: "brakes.reservoir", name: "Brake fluid reservoir", system: "brakes", confidence: 0.18, rationale: "Low fluid lets air into the system." },
      { partId: "brakes.caliper.fl", name: "Front-left brake caliper", system: "brakes", confidence: 0.1, rationale: "A leaking piston seal shows as fluid on the inner tire." },
    ],
  };
  const tests = {
    type: "safety_tests", intro: "These checks are done with the car parked. They help tell a leak from a worn master cylinder.",
    tests: [
      { id: "fluid", title: "Check the brake fluid level", why: "Low fluid means a leak or worn pads.", steps: ["Park on level ground, engine off.", "Open the hood and find the translucent reservoir near the windshield on the driver side.", "Compare the fluid to the MIN and MAX marks."], safetyNote: "Don't open the cap. Brake fluid damages paint.", answerOptions: ["Between MIN and MAX", "At or below MIN", "Can't find it"] },
      { id: "hold", title: "Engine-on pedal hold test", why: "A pedal that slowly sinks under steady pressure points to the master cylinder.", steps: ["In Park with the parking brake set, start the engine.", "Press the brake pedal firmly and hold it for 30 seconds."], safetyNote: "Stay in Park the whole time.", answerOptions: ["Stays firm", "Slowly sinks", "Goes to the floor"] },
      { id: "wet", title: "Look for wet spots at each wheel", why: "Fluid on the inside of a tire means a caliper or hose leak.", steps: ["Use a flashlight to look at the inner side of each wheel and the ground beneath."], safetyNote: "Don't crawl under the car.", answerOptions: ["All dry", "Wet at one wheel", "Not sure"] },
    ],
  };
  window.__chat.setState({ messages: [
    { id: "u1", role: "user", blocks: [{ kind: "text", text: "My brake isn't working properly. The pedal feels soft and sinks." }] },
    { id: "a1", role: "assistant", blocks: [
      { kind: "tool", id: "t1", name: "show_diagnosis", label: "Ranking likely causes", status: "done" },
      { kind: "ui", event: diag },
      { kind: "text", text: "**Please don't drive the car** until this is checked. A sinking pedal can mean the brakes won't stop you.\n\nI've highlighted the four most likely culprits on the model. The checks below are safe to do in your driveway and help narrow it down." },
      { kind: "ui", event: tests, answers: { fluid: "At or below MIN" } },
    ] },
  ] });
  window.__applyUi(diag);
  return "ok";
})();
