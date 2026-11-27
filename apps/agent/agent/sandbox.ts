import { defineSandbox } from "eve/sandbox";
import { defineSandboxProvider } from "eve/sandbox/provider";

// Inventory uses explicit Go API tools only. Do not mount a Docker socket,
// host filesystem or shell in the agent container, including during its build.
export const ApiOnlySandbox = defineSandboxProvider({
  name: "openstockai-api-only",
  environment() {
    return {
      async prepare() {
        return { version: 1 };
      },
      async start() {
        throw new Error("This agent only allows API tools; the sandbox is disabled.");
      },
      async resume() {
        throw new Error("This agent only allows API tools; the sandbox is disabled.");
      },
    };
  },
});

export const environment = ApiOnlySandbox.environment();
export default defineSandbox(() => environment.open());
