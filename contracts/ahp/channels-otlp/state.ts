// Vendored from dspo's AHP spec checkout (microsoft/agent-host-protocol):
//   repo:    ~/projects/github/agent-host-protocol  (remote: https://github.com/microsoft/agent-host-protocol.git)
//   commit:  296b25e7b698a4a84a0ee5a28d9573e70048a0bf  (working tree clean at vendoring time)
//   spec:    v0.9.0 (clients/typescript package.json version), LAST_SYNCED_COMMIT file said 20c6b266 (not resolvable locally)
//   pin:     contracts/ahp/PIN.md — read it before syncing; do not edit these files by hand.
// The only transform applied at vendoring time: relative import specifiers lost
// their `.js` suffix (upstream ships ESM `.js` extensions; this app resolves
// extensionless TS). Everything else is byte-identical to the pinned commit.
/**
 * OTLP Channel State Types — Capability descriptor advertised by the agent
 * host on the root channel so clients can discover the URIs of any
 * OpenTelemetry signal channels (`ahp-otlp:` scheme) the host emits.
 *
 * Stability: 2 - Stable
 *
 * @module channels-otlp/state
 */

import type { URI } from '../common/state';

// ─── TelemetryCapabilities ───────────────────────────────────────────────────

/**
 * OTLP telemetry channels the agent host emits.
 *
 * Each field, when present, is either a literal channel URI or an
 * [RFC 6570](https://datatracker.ietf.org/doc/html/rfc6570) URI template
 * a client expands and then subscribes to. Absent fields indicate the host
 * does not emit that signal.
 *
 * Channel URIs use the `ahp-otlp:` scheme. The scheme identifies the
 * protocol (OpenTelemetry over AHP) so clients can recognise the channel
 * type by URI alone; the host is free to choose any authority/path that
 * makes sense for its implementation. Clients MUST treat the URI as
 * opaque (apart from expanding any well-known template variables defined
 * below) and subscribe with the resulting concrete URI.
 *
 * Payloads delivered on these channels are OTLP/JSON values — see
 * [opentelemetry-proto](https://github.com/open-telemetry/opentelemetry-proto)
 * for the wire shapes (`ExportLogsServiceRequest`,
 * `ExportTraceServiceRequest`, `ExportMetricsServiceRequest`).
 *
 * @category Telemetry
 */
export interface TelemetryCapabilities {
  /**
   * Channel URI (or RFC 6570 URI template) for OTLP log records
   * (`otlp/exportLogs` notifications).
   *
   * The following template variables are defined by this protocol; any
   * other variable name MUST be ignored by clients (there is no
   * protocol-defined way to obtain values for unknown variables):
   *
   * | Variables in template | Meaning                                                                                                 |
   * | --------------------- | ------------------------------------------------------------------------------------------------------- |
   * | _(none)_              | The host does not support subscriber-side severity filtering. The template is itself a subscribable URI. |
   * | `{level}`             | Minimum OTLP severity to deliver. Expand to one of the [OTLP `SeverityNumber`](https://opentelemetry.io/docs/specs/otel/logs/data-model/#field-severitynumber) short names (case-insensitive): `trace`, `debug`, `info`, `warn`, `error`, `fatal`. The server delivers log records whose `severityNumber` falls in the corresponding band or above. |
   *
   * Hosts SHOULD honour the expanded `{level}`; clients MUST still filter
   * defensively in case a host ignores the parameter. Hosts that do not
   * advertise `{level}` deliver all severities.
   *
   * Future protocol versions MAY add new well-known variables (e.g. scope
   * or attribute filters).
   */
  logs?: URI;
  /**
   * Channel URI for OTLP spans (`otlp/exportTraces` notifications). No
   * template variables are defined by this protocol version.
   */
  traces?: URI;
  /**
   * Channel URI for OTLP metric data points (`otlp/exportMetrics`
   * notifications). No template variables are defined by this protocol
   * version.
   */
  metrics?: URI;
}
