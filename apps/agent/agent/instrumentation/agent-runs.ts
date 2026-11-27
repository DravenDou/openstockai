import { agentRuns } from "eve/instrumentation/otel";

export default agentRuns({
  exportPolicy: {
    // Keep user content private even if process-wide capture is widened later.
    span: () => ({ redact: true, inputs: true, outputs: true }),
  },
});
