/**
 * Hosted-ElevenLabs multi-turn voice demo for @langwatch/scenario.
 *
 * Three scenarios, in increasing autonomy:
 *   1. connect + greeting drain + one voiced exchange,
 *   2. explicit multi-turn including a bare user() the simulator invents + voices,
 *   3. proceed(N), which synthesizes each generated user turn to audio.
 *
 * Run all three:       npm run run
 * Run a subset/order:  npm run run -- 1        (just #1)
 *                      npm run run -- 3 2      (#3 then #2)
 */
import scenario from "@langwatch/scenario";
import type { ScenarioResult, ScriptStep } from "@langwatch/scenario";
import { openai } from "@ai-sdk/openai";

// The judge and the user-simulator are local LLM agents — each REQUIRES a model
// (the hosted ElevenLabs agent under test brings its own cloud LLM and needs none).
// Reads OPENAI_API_KEY from env. Not needed for the scripted-text transport itself.
const model = openai("gpt-5-mini");

// --- required env (validated before any socket is opened) ---
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const ELEVENLABS_AGENT_ID = process.env.ELEVENLABS_AGENT_ID;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY; // read by the SDK (user-sim TTS + judge)

const missing = (
  [
    ["ELEVENLABS_API_KEY", ELEVENLABS_API_KEY],
    ["ELEVENLABS_AGENT_ID", ELEVENLABS_AGENT_ID],
    ["OPENAI_API_KEY", OPENAI_API_KEY],
  ] as const
)
  .filter(([, v]) => !v)
  .map(([k]) => k);

if (missing.length > 0) {
  console.error(
    `Missing required env var(s): ${missing.join(", ")}.\n` +
      `Copy .env.example to .env and fill them in (ELEVENLABS_API_KEY, ELEVENLABS_AGENT_ID, OPENAI_API_KEY).`,
  );
  process.exit(1);
}

// Present after the guard above.
const agentId = ELEVENLABS_AGENT_ID as string;
const apiKey = ELEVENLABS_API_KEY as string;

// In-character user-simulator persona (becomes the sim's system prompt → spoken by TTS,
// so it must stay purely in-character: no framework words like "proceed"/"judge"/"ElevenLabs").
const description =
  "A customer phones their bank's support line for help with routine account questions. They are polite and a little in a hurry.";

// Behavioral, non-brittle judge criteria.
const criteria = [
  "The agent responded helpfully and stayed on topic",
  "The agent did not ignore or talk over the caller",
];

interface ScenarioDef {
  name: string;
  proves: string;
  /** Built fresh each run; script steps are stateless role descriptors. */
  buildScript: () => ScriptStep[];
}

const scenarios: ScenarioDef[] = [
  {
    name: "1-single-exchange",
    proves: "connect + greeting drain + one voiced exchange",
    buildScript: () => [
      scenario.agent(), // FIRST agent() drains EL's connect-time greeting
      scenario.user("Hi, I have a question about my account balance."),
      scenario.agent(),
      scenario.judge(),
    ],
  },
  {
    name: "2-multiturn-explicit",
    proves:
      "explicit multi-turn including a bare user() the simulator invents + voices",
    buildScript: () => [
      scenario.agent(),
      scenario.user("Hi, I'd like to check my account balance."),
      scenario.agent(),
      scenario.user("Thanks. What are your support hours this week?"),
      scenario.agent(),
      scenario.user(), // bare user() = simulator invents + voices its own next line
      scenario.agent(),
      scenario.judge(),
    ],
  },
  {
    name: "3-multiturn-proceed",
    proves: "proceed(4) sends audio per turn and drives autonomous turns",
    buildScript: () => [
      scenario.agent(),
      scenario.user("Hi, I have a couple of account questions."),
      scenario.agent(), // REQUIRED: drains the reply, else agent();user();proceed() doubles the user turn
      scenario.proceed(4), // each generated user turn is synthesized to audio
      scenario.judge(),
    ],
  },
];

/** Per-role message tally, e.g. "user=4, assistant=4, tool=1". */
function turnCounts(messages: ScenarioResult["messages"]): string {
  const counts = new Map<string, number>();
  for (const m of messages) counts.set(m.role, (counts.get(m.role) ?? 0) + 1);
  const parts = [...counts.entries()].map(([role, n]) => `${role}=${n}`);
  return parts.length ? parts.join(", ") : "(none)";
}

/**
 * Run one scenario with FRESH adapters (each ElevenLabs adapter opens its own
 * socket, never reused across runs). A thrown error (a timeout, "receiveAudio
 * timed out", "realtime user unsupported") is a transport failure: caught,
 * printed as THREW, and the next scenario still runs.
 *
 * If a real agent is simply slow to start speaking, raise the wait with
 * `agent.responseTimeout = 180` on the adapter instance before running.
 */
async function runOne(def: ScenarioDef): Promise<void> {
  console.log(`\n=== ${def.name} ===`);
  console.log(`proves: ${def.proves}`);
  const started = Date.now();
  try {
    const result = await scenario.run({
      name: def.name,
      description,
      agents: [
        scenario.elevenLabsAgent({ agentId, apiKey }),
        scenario.userSimulatorAgent({ voice: "openai/nova", model }),
        scenario.judgeAgent({ criteria, model }),
      ],
      script: def.buildScript(),
    });
    const secs = ((Date.now() - started) / 1000).toFixed(1);
    console.log(`success: ${result.success}`);
    console.log(`reasoning: ${result.reasoning ?? "(none)"}`);
    if (result.metCriteria?.length)
      console.log(`metCriteria: ${JSON.stringify(result.metCriteria)}`);
    if (result.unmetCriteria?.length)
      console.log(`unmetCriteria: ${JSON.stringify(result.unmetCriteria)}`);
    console.log(
      `turns by role: ${turnCounts(result.messages)} (total messages: ${result.messages.length})`,
    );
    console.log(`elapsed: ${secs}s`);
  } catch (err) {
    const secs = ((Date.now() - started) / 1000).toFixed(1);
    console.log(`THREW: ${err instanceof Error ? err.message : String(err)}`);
    console.log(`elapsed: ${secs}s`);
  }
}

// --- selection: optional argv picks scenarios (in the given order); default = all ---
const args = process.argv.slice(2);
let selected: ScenarioDef[];
if (args.length > 0) {
  selected = [];
  for (const a of args) {
    const match = scenarios.find(
      (s) => s.name === a || s.name.startsWith(`${a}-`),
    );
    if (match && !selected.includes(match)) selected.push(match);
  }
  if (selected.length === 0) {
    console.error(
      `No scenarios matched: ${args.join(", ")}. Available: ${scenarios
        .map((s) => s.name)
        .join(", ")}`,
    );
    process.exit(1);
  }
} else {
  selected = scenarios;
}

console.log(
  `Running ${selected.length} scenario(s): ${selected.map((s) => s.name).join(", ")}`,
);
console.log("Voice runs are slow (~15-40s per turn). Sequential.\n");

for (const def of selected) {
  await runOne(def); // sequential — one failure never aborts the others
}

process.exit(0); // manual demo, not CI: always exit clean (voice sockets can leave open handles)
