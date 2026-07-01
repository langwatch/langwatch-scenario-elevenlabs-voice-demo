# scenario-050-repro

Standalone, run-from-scratch repro proving **`@langwatch/scenario@0.5.0`** (JavaScript)
works for a **hosted-ElevenLabs multi-turn voice** scenario:
`scenario.elevenLabsAgent()` as the agent under test, a `openai/nova` voice
user-simulator, and an LLM judge — driven both by an explicit script and by
`proceed()`.

It exists to disprove three failures a client hit on `0.4.12`:
connect/greeting handling, autonomous multi-turn, and — the headline bug —
`proceed()` sending **text** to a voice agent instead of **audio**.

> Clean-room: every API name/signature used here was resolved solely from the
> installed package's public types
> (`node_modules/@langwatch/scenario/dist/index.d.ts`) — no example tests or docs
> were consulted.

## Prerequisites

- **Node 20+** (Node 24 recommended — this repo uses `node --env-file` natively).
- An **ElevenLabs Conversational AI agent** (provisioned in the EL dashboard) plus
  its API key.
- An **OpenAI API key** — it powers both the `openai/nova` voice user-simulator
  (TTS) and the judge.
- Network egress to ElevenLabs + OpenAI. Voice runs are **slow** (~15-40s/turn);
  budget several minutes for a multi-turn scenario.

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
npm run run -- 3 2     # scenario 3 then 2 (voice runs are slow — prioritize)
```

`npm run typecheck` type-checks `src/run.ts` against the installed `.d.ts`.

## The model requirement (why `@ai-sdk/openai` is a dependency)

The hosted ElevenLabs agent brings its own cloud LLM, but the **judge** and the
**user-simulator** are local LLM agents — each needs a **model** (an AI-SDK
`LanguageModel`). If you omit it the run throws
`[JudgeAgent] ... "A model is required."`. This repo passes
`openai("gpt-4o-mini")` (from `@ai-sdk/openai`, which reads `OPENAI_API_KEY`) to
both:

```ts
scenario.userSimulatorAgent({ voice: "openai/nova", model })
scenario.judgeAgent({ criteria, model })
```

(A scripted `user("literal text")` turn does **not** invoke the simulator's LLM —
it is voiced verbatim — which is why scenario 1's transport half runs even before
the judge's model is reached.)

## Logging & diagnostics

Verified against the installed `0.5.0` package (`dist/*.js`):

| env var | effect |
| --- | --- |
| `LOG_LEVEL` | SDK log verbosity — `DEBUG` \| `INFO` \| `WARN` \| `ERROR` (case-insensitive; **default `INFO`**). Set `LOG_LEVEL=debug` for full trace. |
| `SCENARIO_HEADLESS` | `"true"` = headless: suppress the live TUI, print only final results. |
| `LANGWATCH_API_KEY` | Optional — stream simulation traces to the LangWatch cloud UI (also reads `LANGWATCH_ENDPOINT`, `LANGWATCH_THREAD_ID`). Observability, not local logging. |

To silence the `AI SDK Warning …` lines the AI-SDK prints (compatibility-mode /
system-message notes), set the AI-SDK **global** (not an env var) before running:
`globalThis.AI_SDK_LOG_WARNINGS = false`.

> Note: `SCENARIO_LOG_LEVEL` and `SCENARIO_LOG_FILE` are **not** read by `0.5.0`
> (they appear in some older/Python setups). Use `LOG_LEVEL`; there is no built-in
> log-to-file env var in this version.

## What each scenario proves

The user-simulator's persona/`description` is deliberately **in-character** (it
becomes the simulator's system prompt and is spoken aloud by the TTS voice) — so
it contains no framework words like "proceed"/"judge"/"ElevenLabs" that would
otherwise be read out and derail the call. **If you point this at your own EL
agent, change `description` to match YOUR agent's domain** (the bundled one is a
bank support line).

- **`1-single-exchange`** — `[ agent(), user("…balance."), agent(), judge() ]`.
  The leading `agent()` drains ElevenLabs' connect-time greeting; the second
  `agent()` answers the caller. Proves connect + greeting + one voiced exchange
  with **no `receiveAudio timed out`**.
- **`2-multiturn-explicit`** — adds a **bare `user()`** (no string): the simulator
  invents its own next line and voices it. Proves autonomous multi-turn on the
  scripted path.
- **`3-multiturn-proceed`** — `[ agent(), user("…questions."), agent(), proceed(4), judge() ]`.
  The `agent()` after the opener is **required** — it drains the reply, otherwise
  `agent();user();proceed()` doubles the user turn. `proceed(4)` then drives four
  autonomous turns. On `0.5.0` `proceed()` **synthesizes each generated user turn
  to audio** (issue #705) so the voice agent actually hears it — the client's #1
  bug (proceed sending text) is what this proves is gone.

## Honesty caveat (read before judging pass/fail)

`0.5.0` fixes the **transport / timeout / `proceed`-sends-text** bugs. It does
**not** make hosted ElevenLabs deterministic: residual **coherence flake**
(the hosted agent mishearing a synthesized turn) can still make the **judge**
return `success: false` occasionally at retry 0. That is an ElevenLabs-side
speech artifact, **not** an SDK transport defect.

So separate the two verdicts:

- **Transport verdict** — did turns actually get exchanged (transcripts present,
  role counts > the scripted minimum, **no throw / no timeout**)? This is what
  the fix is about.
- **Judge verdict** — `result.success`. A judge `success: false` **with turns
  actually exchanged** still proves the transport fix; only a **throw** (timeout,
  "receiveAudio timed out", "realtime user unsupported") is a transport failure.

`src/run.ts` prints both: `success` + `reasoning` (judge) alongside per-role turn
counts (transport), and catches any throw as `THREW: <msg>` so one failure never
aborts the other scenarios.
