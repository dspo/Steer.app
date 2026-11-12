// A fixture extension for the M2 extension host: it uses the real pi
// extension API, so the engine's `bindExtensions({ mode: "rpc" })` and the
// shell's UI matrix are exercised end to end without a model call.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    ctx.ui.notify(`probe mode ${ctx.mode}`, "info");
    const ok = await ctx.ui.confirm("Zu extension probe", "Allow the probe?", { timeout: 15000 });
    ctx.ui.notify(`probe confirm: ${ok}`, "info");
    ctx.ui.setStatus("probe", "ready");
    const picked = await ctx.ui.select("Probe choice", ["alpha", "beta"], { timeout: 15000 });
    ctx.ui.notify(`probe select: ${picked ?? "none"}`, "info");
  });
}
