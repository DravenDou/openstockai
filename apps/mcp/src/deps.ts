import type { Config } from "./env";

// Everything the service takes from the outside world, so tests run fully in-process.
export type Deps = {
  config: Config;
  fetch: typeof fetch;
  now: () => number;
};
