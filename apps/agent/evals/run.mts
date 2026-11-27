// `pnpm agent:eval`: runs the Eve evals against a throwaway stack that never touches your data.
//
//   1. writes a private temporary env file (random secrets, high ports, your LLM_* values)
//   2. starts the app under the compose project `openstockai-eval` with its own volumes
//   3. creates the fixture owner and a deterministic fixture through the public APIs
//   4. runs `eve eval` (guarded by evals.config.ts) and then removes the stack and its volumes
//
// Needs Docker and a real LLM key. Extra arguments are passed to `eve eval`
// (for example `pnpm agent:eval -- approval`). Flags: --keep leaves the stack up,
// --check only validates the LLM configuration and Docker, then exits.
import { spawn, type SpawnOptions } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseEnv } from "node:util";
import { llmConfigProblem } from "@openstockai/server/ai/config";
import { createOwner, FIXTURE_PROJECT, seedFixture, type Fixture } from "./seed";

const root = resolve(import.meta.dirname, "../../..");
const agentDir = resolve(import.meta.dirname, "..");
const ports = { web: 3917, api: 8987, postgres: 55917, agent: 4373 };
const llmKey = /^(LLM_|AI_)/;

const args = process.argv.slice(2).filter((arg) => arg !== "--");
const keep = args.includes("--keep");
const check = args.includes("--check");
const evalArgs = args.filter((arg) => arg !== "--keep" && arg !== "--check");

function run(command: string, commandArgs: string[], options: SpawnOptions = {}) {
  return new Promise<number>((resolveExit) => {
    const child = spawn(command, commandArgs, { stdio: "inherit", ...options });
    child.on("error", () => resolveExit(127));
    child.on("exit", (code) => resolveExit(code ?? 1));
  });
}

// Only LLM_* and AI_* are taken from the shell, then from the repo .env. Nothing is printed.
function llmEnvironment() {
  const values: Record<string, string> = {};
  const privateFile = join(root, ".env");
  if (existsSync(privateFile))
    for (const [key, value] of Object.entries(parseEnv(readFileSync(privateFile, "utf8"))))
      if (llmKey.test(key) && value) values[key] = value;
  for (const [key, value] of Object.entries(process.env))
    if (llmKey.test(key) && value) values[key] = value;
  return values;
}

function writeEnvFile(directory: string, llm: Record<string, string>, evalToken: string) {
  const initial = {
    COMPOSE_PROJECT_NAME: FIXTURE_PROJECT,
    WEB_PORT: ports.web,
    API_PORT: ports.api,
    POSTGRES_PORT: ports.postgres,
    EVAL_AGENT_PORT: ports.agent,
    OPENSTOCK_EVAL_TOKEN: evalToken,
    ...llm,
  };
  writeFileSync(
    join(directory, ".env"),
    Object.entries(initial)
      .map(([key, value]) => `${key}=${JSON.stringify(String(value))}`)
      .join("\n") + "\n",
    { mode: 0o600 },
  );
  chmodSync(join(directory, ".env"), 0o600);
  return join(directory, ".env");
}

async function waitFor(label: string, check: () => Promise<boolean>, seconds = 300) {
  const deadline = Date.now() + seconds * 1000;
  while (Date.now() < deadline) {
    if (await check().catch(() => false)) return;
    await new Promise((done) => setTimeout(done, 3000));
  }
  throw new Error(`Timed out waiting for ${label}.`);
}

async function main() {
  const llm = llmEnvironment();
  const problem = llmConfigProblem(llm);
  if (problem) {
    console.error(`The evals need a real LLM. ${problem}\nSet LLM_* in your shell or in .env.`);
    return 2;
  }
  if ((await run("docker", ["compose", "version"], { stdio: "ignore" })) !== 0) {
    console.error("Docker Compose is required to start the isolated eval stack.");
    return 2;
  }
  if (check) {
    console.log(
      "Eval prerequisites look fine: LLM configuration is valid and Docker Compose is available.",
    );
    return 0;
  }
  const directory = mkdtempSync(join(tmpdir(), "openstockai-eval-"));
  const compose = (rest: string[], env = join(directory, ".env")) =>
    run(
      "docker",
      [
        "compose",
        "-p",
        FIXTURE_PROJECT,
        "--env-file",
        env,
        "-f",
        join(root, "compose.yaml"),
        "-f",
        join(import.meta.dirname, "compose.eval.yaml"),
        ...rest,
      ],
      { cwd: root },
    );
  const evalToken = randomBytes(32).toString("base64url");
  let exit = 1;
  try {
    writeEnvFile(directory, llm, evalToken);
    console.log(
      `Starting the isolated stack "${FIXTURE_PROJECT}" (ports ${Object.values(ports).join(", ")})...`,
    );
    if ((await compose(["up", "-d", "--build"])) !== 0)
      throw new Error("docker compose up failed.");
    // Better Auth trusts only BETTER_AUTH_URL (http://localhost:<port> in Compose), so the fixture
    // must use the same host name for its Origin header.
    const base = `http://localhost:${ports.web}`;
    const agentUrl = `http://127.0.0.1:${ports.agent}`;
    await waitFor("the web app", async () => (await fetch(`${base}/api/setup-status`)).ok);
    await waitFor(
      "the agent",
      async () => (await fetch(agentUrl, { signal: AbortSignal.timeout(3000) })).status < 500,
    );
    console.log("Creating the fixture owner and data through the public APIs...");
    const owner = await createOwner(base, randomBytes(18).toString("base64url"));
    const data = await seedFixture(base, owner.cookie);
    const fixture: Fixture = { project: FIXTURE_PROJECT, base, agentUrl, owner, ...data };
    const fixturePath = join(directory, "fixture.json");
    writeFileSync(fixturePath, JSON.stringify(fixture), { mode: 0o600 });
    exit = await run("pnpm", ["exec", "eve", "eval", "--url", agentUrl, ...evalArgs], {
      cwd: agentDir,
      env: {
        ...process.env,
        OPENSTOCK_EVAL_FIXTURE: fixturePath,
        // Eve 1 reads /eve/v1/info before the run, which needs an operator credential. The eval
        // stack's agent accepts this per-run bearer token (see agent/channels/eve.ts); evals still
        // send the owner's cookie and service header on each message. `targetAuth` would require
        // an HTTPS target, so the environment override is used.
        EVE_EVAL_AUTH_TOKEN: evalToken,
      },
    });
  } catch (error) {
    console.error((error as Error).message);
  } finally {
    if (keep)
      console.log(
        `Leaving the stack up. Remove it with: docker compose -p ${FIXTURE_PROJECT} down -v`,
      );
    else {
      console.log("Removing the eval stack and its volumes...");
      // The project name is the constant above, so this can never touch your real stack.
      await compose(["down", "-v", "--remove-orphans"]);
    }
    rmSync(directory, { recursive: true, force: true });
  }
  return exit;
}

process.exit(await main());
