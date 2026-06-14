# ThonkBoard

A spatial ideation canvas with an AI thinking partner. No backend, no accounts — everything runs in the browser and stays on your machine.

> **License:** [Polyform NonCommercial 1.0.0](LICENSE) — free for personal, educational, and internal business use. Selling or building a commercial product on top of it requires permission.

![ThonkBoard](.github/screenshot.png)

## What it does

You build a graph of ideas. Each node is a thought. AI can question, critique, propose, and argue around any node. Questions wait for answers. Answers get approved and integrated back into the parent node — rewriting it in place, incorporating what you learned.

The goal is to help **you** think, not to think for you. AI adds pressure and new angles; you steer.

## Getting started

```bash
npm install
npm run dev
```

Then add an AI key via the "Set AI key" button in the top bar. Keys are stored in `localStorage` only, sent directly to your chosen provider.

## AI providers

ThonkBoard works with any of these — pick one you already have access to:

| Provider | Free tier | Notes |
|----------|-----------|-------|
| Google Gemini | Yes (Google AI Studio) | Default. Supports grounded web search. |
| OpenAI | No | GPT-4o mini / GPT-4o |
| Anthropic | No | Claude Haiku / Claude Sonnet |
| DeepSeek | Yes | deepseek-chat / deepseek-reasoner |
| Ollama | Local only | Any model you have pulled. **Requires running ThonkBoard locally** — Ollama's API does not allow cross-origin requests from hosted sites (CORS). |

**Turbo Thonking** switches to the smarter/slower model for the active provider. The toggle is in the top bar.

## Node types

| Type | Color | Purpose |
|------|-------|---------|
| Core | Dark purple | Central idea, thesis, or topic |
| Idea | Yellow | Branch, proposal, or related thought |
| Problem | Red-orange | Flaw, risk, or blocker with severity score |
| Question | White + animated dashed border | Open thread waiting for an answer |
| Answer | Green | Response to a question; can be approved back into parent |
| Note | Beige | Freeform sticky — no structure required |

## AI passes

All structured calls use `responseMimeType: "application/json"` with a `responseSchema`, so the model returns typed objects rather than free text.

| Action | What it does |
|--------|-------------|
| **Find Problems** | Adversarial critique; spawns Problem nodes with severity scores |
| **Ask me** | Generates the single most natural follow-up question |
| **Answer me** | AI answers a question in context (with grounded web search on Gemini) |
| **Suggest Solution** | Proposes a concrete fix or next step for a Problem node |
| **Generate Ideas** | Expands a node with new branches in the same domain |
| **Propose** | Generates sibling ideas approaching the concept from different angles |
| **Summarize** | Generates a 1–2 sentence preview stored on the node |
| **Approve** | Integrates a Q&A exchange back into the parent node body |
| **Merge Idea** | Adopts an Idea node as the accepted direction, rewriting the parent |
| **Reject** | Records that an answer or idea was considered and declined |
| **Fix Grammar** | Minimal spelling/punctuation fix, preserving tone and structure |
| **Board Summary** | Arranges all core + idea nodes into a flowing brief using the board's own words |
| **Conflict Detection** | After approving a Q&A, checks other nodes for logical contradictions |
| **Conflict Resolution** | Generates two genuinely opposite resolution paths when a merge conflicts |

AI-generated nodes track their **generation depth**. Chains that drift far from your own writing show a warning badge — the further from your reasoning, the less useful the AI output becomes.

## Multiple boards

The board switcher (hamburger menu) lets you create, rename, and delete independent boards. Each board is a separate canvas stored in `localStorage`. Switch between them without losing state.

## File I/O

Boards save as `.thonk` files (JSON). The File System Access API is used when available (Chrome/Edge), letting you silently overwrite the same file on Ctrl+S. Firefox falls back to a download.

- **Save / Save as…** — exports the current board to a `.thonk` file
- **Load board** — imports a `.thonk` or `.json` file
- **Export as PNG** — captures the visible canvas as a PNG image

## Privacy

ThonkBoard has no server. Nothing you type is stored outside your browser. AI calls go directly from your browser to your chosen provider using your own key. With Ollama, all processing is local — nothing leaves your machine.

Do not use ThonkBoard in incognito/private mode — browsers wipe `localStorage` on close.

## Tech stack

- **Vite + React + TypeScript** (strict, `verbatimModuleSyntax`)
- **@xyflow/react v12** — spatial canvas, controlled mode
- **Tailwind CSS v4** — `@theme {}` block for color tokens, no `tailwind.config.js`
- **shadcn/ui** — manually installed (CLI is incompatible with Tailwind v4)
- **localStorage** — all persistence, no backend
- **react-markdown + remark-gfm** — markdown preview in the detail panel

## Key files

```
src/
  store/
    types.ts          # ThonkNode, ThonkEdge, ThonkGraph, BoardMeta interfaces
    graph.ts          # Pure functions: addNode, updateNode, deleteNode, migration
    useGraph.ts       # React hook: graph state + localStorage persistence
  ai/
    types.ts          # AIRequest, Provider
    gemini.ts         # All AI calls, provider dispatch, structured prompts
    anthropic.ts      # Anthropic API adapter
    openai-compat.ts  # OpenAI-compatible adapter (OpenAI, DeepSeek, Ollama)
    context.ts        # assembleContext: builds target + neighbors + board skeleton
  components/
    nodes/
      NodeShell.tsx         # Root div with handles, type styling, resolved dimming
      ThonkNode.tsx         # Full node: toolbar, editing, AI actions, answer flow
      NoteNode.tsx          # Freeform note node
      MergeConflictModal.tsx # Two-option conflict resolution UI
    EditorPanel.tsx   # 420px right panel: markdown editor + preview
    TopBar.tsx        # Boards, add node, AI key, Turbo toggle, hide resolved
    SummarizeModal.tsx # Board summary generation and display
  App.tsx             # Root: RF setup, drag/drop, node/edge filtering, panels
  index.css           # Tailwind v4 @theme block, marching-ants animation, RF tweaks
```

## Architecture notes

- `useGraph` owns all graph state and persists to `thonk.graph` in localStorage (debounced 500ms).
- React Flow runs in **controlled mode**: nodes and edges are props derived from the store.
- During drag, `applyNodeChanges` updates local `rfNodes` state every frame. The store is written only on drag end — prevents edge re-renders during drag.
- `selectedIds: Set<string>` is tracked separately in App state and passed to each node via `toRFNode`.
- `resolved: boolean` marks closed Q&A pairs. "Hide resolved" filters them from the canvas.
- `conflicts: ConflictEntry[]` on each node stores contradictions detected after approval.

## Quirks worth knowing

- **Tailwind v4**: utilities like `bg-background` require variables in `@theme {}`. No `tailwind.config.js`.
- **shadcn/ui CLI** doesn't work with Tailwind v4; components were created manually.
- **`verbatimModuleSyntax`**: all type-only imports must use `import type { ... }`.
- **`nodrag` class**: only on interactive elements (inputs, textareas, buttons, toolbar div). Container divs must NOT have it or the node becomes non-draggable.
- **`NodeToolbar`** must be rendered inside `NodeShell` (not a fragment sibling) for RF to correctly attach drag handlers to the node root.
- **Grounded search**: Gemini's Google Search grounding has a separate quota. ThonkBoard auto-falls-back to a plain prompt on 429.
