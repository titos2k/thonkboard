# THONK

A single-user, browser-only spatial ideation canvas with an AI thinking partner. No backend, no accounts, no server — everything runs in the browser.

## What it does

You build a graph of ideas. Each node is a thought. AI can question, argue, and propose around any node. Questions wait for answers. Answers get approved and integrated back into the idea — rewriting the original node's documentation in place.

## Tech stack

- **Vite + React + TypeScript** (strict, `verbatimModuleSyntax`)
- **@xyflow/react v12** — spatial canvas, controlled mode
- **Tailwind CSS v4** — `@theme {}` block for color tokens, no CSS-in-JS
- **shadcn/ui** — manually installed components (Button, Input, Textarea, Dialog, Tooltip, Separator)
- **localStorage** — all persistence, no backend
- **Google Gemini API** — called directly from the client (`gemini-3.1-flash-lite` or `gemini-3.5-flash`)
- **react-markdown + remark-gfm** — markdown preview in the detail panel

## Node types

| Type | Color | Purpose |
|------|-------|---------|
| Core | Blue | Central idea or concept |
| Idea | Yellow | Derived or related thought |
| Problem | Red | Flaw, risk, or blocker with severity score |
| Question | White + animated dashed border | AI-generated question waiting for an answer |
| Answer | Green | Response to a question; can be approved back into Core |

## AI passes

All AI calls use `responseMimeType: "application/json"` with a `responseSchema`.

- **Question** — generates the single most natural follow-up question from reading the node; avoids repeating previously asked questions
- **Argue** — adversarial critique; spawns Problem nodes with severity scores
- **Propose** — generates sibling ideas in the same domain (Lightbulb icon)
- **Propose Fix** — on Problem nodes; generates fix ideas
- **Summarize** — 1-2 sentence summary stored on the node, shown as preview text
- **Integrate Q&A** — on Approve; rewrites the core node's body incorporating the Q&A exchange, optionally refines title if answer fundamentally changes the concept

## State architecture

- `useGraph` hook owns all graph state. Persists to `thonk.graph` in localStorage (debounced 500ms).
- React Flow runs in **controlled mode**: `nodes` and `edges` are props derived from the store.
- During drag, `applyNodeChanges` updates a local `rfNodes` state every frame. Store is written only on drag end — prevents edge flicker during drag.
- `selectedIds: Set<string>` is tracked separately in App state and passed to each node via `toRFNode`.
- `autoEditId` triggers auto-focus on newly created nodes (cleared after one render via `setTimeout`).
- `resolved: boolean` on nodes marks approved Q&A pairs as done. "Hide resolved" toggle filters them from the canvas.

## Key files

```
src/
  store/
    types.ts          # ThonkNode, ThonkEdge, ThonkGraph interfaces
    graph.ts          # Pure functions: addNode, updateNode, deleteNode, migration
    useGraph.ts       # React hook wrapping graph state + localStorage
  ai/
    gemini.ts         # All Gemini API calls, model selection, system prompts
    context.ts        # assembleContext: builds target + neighbors + skeleton prompt
  components/
    nodes/
      NodeShell.tsx   # Wrapper div with handles, type-based styling, resolved dimming
      ThonkNode.tsx   # Full node component: floating toolbar, editing, AI actions, answer flow
    EditorPanel.tsx   # 420px right panel: markdown editor + preview, copy button
    TopBar.tsx        # Add nodes, API key, Turbo Thonking toggle, Hide resolved toggle
  App.tsx             # Root: RF setup, drag/drop, node/edge filtering, panel state
  index.css           # Tailwind v4 @theme block, marching-ants animation, RF tweaks
```

## Running locally

```bash
npm install
npm run dev
```

Set your Gemini API key via the "Set API Key" button in the top bar. It's stored in `localStorage` only and sent directly to Google.

## Quirks worth knowing

- **Tailwind v4**: utilities like `bg-background` require variables defined in `@theme {}`. No `tailwind.config.js`.
- **shadcn/ui CLI** doesn't work with Tailwind v4; components were created manually.
- **`verbatimModuleSyntax`**: all type-only imports must use `import type { ... }`.
- **React Flow drag**: node positions during drag are tracked in local state via `applyNodeChanges`, not the store. Store is written only on drag end. This prevents edge re-renders during drag.
- **`nodrag` class**: only on interactive elements (inputs, textareas, buttons, toolbar div). Container divs must NOT have it or the node won't be draggable.
- **`NodeToolbar`** must be rendered inside the `NodeShell` div (not a fragment sibling) for RF to correctly attach drag handlers to the node root.
