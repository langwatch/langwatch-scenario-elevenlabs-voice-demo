# langwatch-scenario-elevenlabs-voice-demo

A standalone, run-from-scratch demo of **`@langwatch/scenario`** (JavaScript)
driving a **hosted-ElevenLabs multi-turn voice** scenario:
`scenario.elevenLabsAgent()` as the agent under test, an `openai/nova` voice
user-simulator, and an LLM judge. It runs both an explicit script and a
`proceed()`-driven autonomous conversation.

Point it at your own ElevenLabs Conversational AI agent and you have a working
starting point for voice testing in about five minutes.

## Prerequisites

- **Node 20+** (Node 24 recommended, this repo uses `node --env-file` natively).
- An **ElevenLabs Conversational AI agent** provisioned in the EL dashboard, plus
  its API key.
- An **OpenAI API key**. It powers both the `openai/nova` voice user-simulator
  (TTS) and the judge.
- Network egress to ElevenLabs and OpenAI. Voice runs are **slow** (roughly
  15 to 40s per turn), so budget several minutes for a multi-turn scenario.

## Setup

```bash
npm install
cp .env.example .env      # then fill in the three required keys
```

`.env` keys:

| var                  | required | purpose                                             |
| -------------------- | :------: | --------------------------------------------------- |
| `ELEVENLABS_API_KEY` |   yes    | auth for the hosted ConvAI agent (`xi-api-key`)     |
| `ELEVENLABS_AGENT_ID`|   yes    | which hosted agent to call                          |
| `OPENAI_API_KEY`     |   yes    | user-simulator TTS (`openai/nova`) + judge model    |
| `LANGWATCH_API_KEY`  | optional | stream simulation traces to the LangWatch cloud UI  |

## Run

```bash
npm run run            # all three scenarios, sequentially, in order
npm run run -- 1       # just scenario 1
npm run run -- 3 2     # scenario 3 then 2 (voice runs are slow, so prioritize)
```

`npm run typecheck` type-checks `src/run.ts` against the installed `.d.ts`.

## The model requirement (why `@ai-sdk/openai` is a dependency)

The hosted ElevenLabs agent brings its own cloud LLM, but the **judge** and the
**user-simulator** are local LLM agents, and each needs a **model** (an AI-SDK
`LanguageModel`). If you omit it the run throws
`[JudgeAgent] ... "A model is required."`. This repo passes a model from
`@ai-sdk/openai` (which reads `OPENAI_API_KEY`) to both:

```ts
scenario.userSimulatorAgent({ voice: "openai/nova", model })
scenario.judgeAgent({ criteria, model })
```

A scripted `user("literal text")` turn does **not** invoke the simulator's LLM,
it is voiced verbatim, which is why scenario 1's transport half runs even before
the judge's model is reached.

## Tracing

Set `LANGWATCH_API_KEY` and the run streams to the LangWatch cloud UI. As of
`@langwatch/scenario` 1.0.0 the **ElevenLabs adapter is instrumented
automatically**: connect, every turn, audio sent and audio received, and
disconnect each emit their own span, with no extra code in your scenario. If a
run fails you can read what the transport actually did instead of reconstructing
it from logs.

See the [voice observability
recipe](https://scenario.langwatch.ai/voice/recipes/observability).

## Slow agents and `responseTimeout`

If your hosted agent runs a tool call, a retrieval step, or anything else before
it speaks, it can exceed the adapter's default wait and the run fails with
`ElevenLabsAgentAdapter: receiveAudio timed out`. The knob is `responseTimeout`
on the adapter instance, in seconds:

```ts
const agent = scenario.elevenLabsAgent({ agentId, apiKey });
agent.responseTimeout = 180; // wait up to 3 minutes for the agent to start speaking
```

Raise it first when a real agent is simply slow, before assuming a transport
bug. More causes and remedies on the [voice troubleshooting
page](https://scenario.langwatch.ai/voice/troubleshooting).

## Logging and diagnostics

| env var | effect |
| --- | --- |
| `LOG_LEVEL` | SDK log verbosity: `DEBUG` \| `INFO` \| `WARN` \| `ERROR` (case-insensitive, default `INFO`). Set `LOG_LEVEL=debug` for a full trace. |
| `SCENARIO_HEADLESS` | `"true"` suppresses the live TUI and prints only final results. |
| `LANGWATCH_API_KEY` | Optional, streams simulation traces to the LangWatch cloud UI (also reads `LANGWATCH_ENDPOINT`, `LANGWATCH_THREAD_ID`). Observability, not local logging. |

To silence the `AI SDK Warning ...` lines the AI-SDK prints (compatibility-mode
and system-message notes), set the AI-SDK **global**, not an env var, before
running: `globalThis.AI_SDK_LOG_WARNINGS = false`.

## What each scenario shows

The user-simulator's persona (`description`) is deliberately **in-character**. It
becomes the simulator's system prompt and is spoken aloud by the TTS voice, so it
contains no framework words like "proceed", "judge" or "ElevenLabs" that would
otherwise be read out and derail the call. **If you point this at your own EL
agent, change `description` to match your agent's domain**, the bundled one is a
bank support line.

- **`1-single-exchange`**, `[ agent(), user("...balance."), agent(), judge() ]`.
  The leading `agent()` drains ElevenLabs' connect-time greeting, the second
  `agent()` answers the caller. Connect, greeting, and one voiced exchange.
- **`2-multiturn-explicit`** adds a **bare `user()`** with no string: the
  simulator invents its own next line and voices it. Autonomous multi-turn on the
  scripted path.
- **`3-multiturn-proceed`**,
  `[ agent(), user("...questions."), agent(), proceed(4), judge() ]`.
  The `agent()` after the opener is **required**, it drains the reply, otherwise
  `agent(); user(); proceed()` doubles the user turn. `proceed(4)` then drives
  four autonomous turns, synthesizing each generated user turn to audio so the
  voice agent actually hears it.

## Reading the result

Hosted ElevenLabs is not deterministic. Residual coherence flake, meaning the
hosted agent mishearing a synthesized turn, can still make the **judge** return
`success: false` on a run where the transport was fine. That is a speech
artifact, not an SDK defect, so read the two verdicts separately:

- **Transport**: did turns actually get exchanged (transcripts present, role
  counts above the scripted minimum, no throw and no timeout)?
- **Judge**: `result.success`. A judge `success: false` **with turns actually
  exchanged** still means the transport worked. Only a **throw** (a timeout,
  `receiveAudio timed out`, `realtime user unsupported`) is a transport failure.

`src/run.ts` prints both: `success` and `reasoning` from the judge alongside
per-role turn counts from the transport, and it catches any throw as
`THREW: <msg>` so one failure never aborts the other scenarios.
