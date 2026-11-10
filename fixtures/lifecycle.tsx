import { mount } from "nsh";
import { AlreadyRunning } from "../lifecycle-ui";
import { instanceClaim, lifecycleMode } from "../lifecycle";

/**
 * The second instance's notice without a second process: the claim a real
 * duplicate would receive, and the same component the app renders in that
 * mode. The claim itself (exclusive create, live owner, stale reclaim) is
 * covered by the Rust tests in `src/instance.rs`.
 */

lifecycleMode.set("duplicate");
instanceClaim.set({
  acquired: false,
  already: false,
  stale: false,
  pid: 9002,
  ownerPid: 4321,
  path: "/tmp/zu-m12/instance.lock",
  startedAt: Date.now(),
});

mount(AlreadyRunning);
