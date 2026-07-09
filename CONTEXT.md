# Zotero Agent — Codex Integration

The glossary for the effort to replace the plugin's custom RAG agent with the OpenAI Codex CLI as the reasoning engine, backed by a durable, file-based cross-paper memory. This file is a glossary only — no implementation details.

## Language

**Knowledge Vault**:
The single, persistent, plugin-owned git directory (at `~/papers`) that holds only *derived* artifacts. One subdirectory per paper, named by Zotero item key, plus a root `AGENTS.md` and a human-facing `README.md`. It is the durable cross-paper memory; it is fully regenerable and never contains original PDFs.
_Avoid_: workspace, scratch dir, project folder

**Paper Directory**:
The per-paper subdirectory `~/papers/{itemKey}/` holding that paper's `text.txt`, `memory.md`, and `conversations/` directory.
_Avoid_: paper folder, item folder

**Conversation Log** (`conversations/{sessionId}.md`):
The episodic, human-facing transcript of one chat session for a paper — one file per session so multiple sessions stay isolated (mirrors the existing multi-session chat UI). Appended every turn by the plugin. Reviewable by the user; NOT fed to Codex as reasoning input (it is verbose and would pollute retrieval).
_Avoid_: chat history, transcript, note

**Memory Note** (`memory.md`):
The semantic, internalized long-term knowledge for a paper — distilled, deduped, curated by Codex over time. This is the unit of durable memory and the thing cross-paper retrieval searches.
_Avoid_: summary, annotation, note (unqualified), conversation

**README** (`README.md`):
The root, human-facing index of the Vault. Maps human-readable title/author/year to clickable relative links into each `{itemKey}/` directory. For people; Codex may also read it.
_Avoid_: index (unqualified)

**Session** (Codex rollout):
Codex's own short-term reasoning continuity for one sidebar chat, resumed by `thread_id`. Ephemeral and disposable — NOT the memory (that is the Memory Note).
_Avoid_: memory, history

**In-Focus Paper**:
The paper the user currently has open in the Zotero reader; communicated to Codex per-turn as context, distinct from the rest of the Vault it may search.
_Avoid_: current item, active paper, selected item

**Memory** (in this project):
The contents of the Knowledge Vault on disk — NOT any automatic learning by Codex. Codex has no background cross-session learning; it only reads/searches/updates the Vault when a turn instructs it to. Codex is the engine; the Vault is the memory.
_Avoid_: Codex memory, learned knowledge, long-term memory (as if automatic)

**Item Key**:
The Zotero item key (e.g. `PXW99EKT`) used to name each paper directory in the Vault. Stable within a library; not a BibTeX citekey.
_Avoid_: citekey, key, id (unqualified)

**Codex** (as used here):
The external OpenAI `codex` CLI, driven headlessly by the plugin, operating with `--cd {vault}`. Assumed already installed and authenticated on the user's machine.
_Avoid_: the agent, the model, the LLM

## Decisions so far (design in progress — not yet ratified)

- Codex **replaces** the custom RAG pipeline as the agent (not coexist / not backend-only).
- Codex operates on **one persistent library-wide Vault**, not per-paper scratch dirs.
- The Vault is a **dedicated derived-artifacts directory** (`~/papers`); source PDFs stay in Zotero `storage/`. Codex gets `workspace-write` only on the Vault.
- Transport: **`codex exec --cd ~/papers --json` per user turn**, spawned via Mozilla `Subprocess`, stdout parsed as JSONL incrementally. The official Node/Python SDKs are unavailable inside Zotero's Gecko (non-Node) runtime.
- Continuity: **one Codex session per sidebar chat thread**, resumed by explicit `thread_id` (captured from the `thread.started` event); `chat-store.ts` remains the UI source of truth.
- `~/papers/{itemKey}/text.txt` is written **deterministically by the plugin** on paper open (reusing `page-cache.ts`/`pdf-parser.ts`), not by Codex.
- **Three separated memory layers** (do not conflate): ① Codex Session (short-term reasoning, disposable), ② Conversation Log `conversations/{sessionId}.md` (episodic, human-only, appended every turn, not fed to Codex), ③ Memory Note `memory.md` (semantic, Codex reads+writes, powers cross-paper retrieval).
- **Memory Note write trigger (RATIFIED):** Codex updates `memory.md` agentically per `AGENTS.md` rules — only on materially-new learning, rewrite/dedupe rather than blind-append. The plugin auto-commits the Vault to git after each turn, so every memory change is a reviewable, revertible diff.
- Vault layout:

```
~/papers/
├── AGENTS.md              # memory discipline (Codex auto-reads)
├── README.md              # human index: title/author/year → link to {itemKey}/
├── .logs/                 # plugin diagnostics (gitignored or local)
└── {itemKey}/
    ├── text.txt           # extracted PDF text (plugin-generated)
    ├── conversations/     # ② episodic logs, one file per session (human-facing)
    │   └── {sessionId}.md
    └── memory.md          # ③ internalized long-term memory (Codex read/write)
```

## Open decisions

- **README maintenance** (minor): who writes/updates the root `README.md` mapping (plugin on paper-add vs Codex). Leaning: plugin writes it deterministically since it has the title/author/year metadata. *(Current implementation: plugin `updateReadme()`.)*
- **memory.md schema** (assumed, not objected): default sections (TL;DR / Key contributions / Method / Results / Understanding / Cross-references) that Codex may extend per paper type; cross-paper links use relative links (`../{otherKey}/memory.md`) to form a navigable knowledge graph.

## Phase 1 decisions

- **codex binary path (Q7):** auto-detect (common install locations + read the user's login-shell PATH) with fallback to a user-set pref (absolute path) plus a "Test codex" button in settings.
- **Old RAG engine (Q8): HARD REPLACE.** `executeAgent` and its RAG-only pipeline are removed, not kept behind a toggle. `submitQuestion` routes only to the Codex runner.
- **Dropped/deferred in Phase 1 (Q9):** image multimodal asks, Context-PDF attach, per-page citation chips, and multi-provider answer routing are all removed for now (each needs separate rebuild). In-chat history/summary machinery is dropped outright (Codex `resume {threadId}` handles continuity). Session titles switch to a local heuristic (first user message), no HTTP call.

## Validated constraints (Phase 0, codex-cli 0.142.5)

- **stdin MUST be closed** when spawning `codex exec`. If stdin is a non-TTY pipe left open, Codex prints "Reading additional input from stdin..." and **hangs forever** after `turn.started`. In the plugin's `Subprocess` call, close/empty stdin immediately (CLI equivalent: `</dev/null`).
- **Event stream shape** (`codex exec --json`, incremental, one JSON per line): `thread.started {thread_id}` → `turn.started` → repeated `item.started`/`item.completed` (types: `agent_message` with `.text`; `command_execution` with `.command`/`.aggregated_output`/`.exit_code`) → `turn.completed {usage:{input_tokens, cached_input_tokens, output_tokens, reasoning_output_tokens}}`.
- `agent_message` arrives as a **whole item** (not token-level deltas) — sidebar streaming granularity is per message/tool-step, coarser than the old token stream.
- **Latency/cost**: a trivial one-line Q&A ≈ 22s wall-clock and ~50k input tokens (AGENTS.md + tool outputs + reasoning dominate). Heavier than the old direct-stream answer; a long silent gap follows `turn.started` — sidebar must show a "thinking" status.
- `-s read-only` cleanly blocks writes without hanging (Codex reports it cannot write). AGENTS.md in the Vault IS read and obeyed; the global `~/.codex/AGENTS.md` was benign.
- This machine's `~/.codex` points at a **custom multi-model gateway** (returns claude/glm/kimi/gpt-5.5/deepseek/…), not native OpenAI. Integration inherits whatever provider `~/.codex` is configured with.

## Future capabilities (deferred)

- **Source-code fetch & analysis**: detect a paper's associated code repo (GitHub URL in the PDF / Papers-with-Code), clone it, and let Codex analyze it. This is Codex's strongest differentiator over the old RAG pipeline. Tentative placement: clone into `{itemKey}/code/` but git-ignore it so the Vault's memory history stays small; Codex reads it via the working dir. Not designed in detail yet.
