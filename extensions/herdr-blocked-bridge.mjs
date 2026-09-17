const KIND_LABELS = {
  select: "Waiting for a selection",
  confirm: "Waiting for confirmation",
  input: "Waiting for input",
  editor: "Waiting for your answer",
  custom: "Waiting for your answer"
};
function herdrBlockedBridge(pi) {
  let waiting = false;
  pi.on("ui_prompt_start", (event) => {
    if (waiting) return;
    waiting = true;
    const title = typeof event?.title === "string" ? event.title.split("\n")[0].trim() : "";
    const label = title ? title.slice(0, 120) : KIND_LABELS[event?.kind] ?? "Waiting for your answer";
    pi.events.emit("herdr:blocked", { active: true, label });
  });
  pi.on("ui_prompt_end", () => {
    if (!waiting) return;
    waiting = false;
    pi.events.emit("herdr:blocked", { active: false });
  });
}
export {
  herdrBlockedBridge as default
};
