# THONK — Claude Code Guidelines

## UI sizing rules

- **Action buttons** (inline buttons inside panels, sidebars, tooltips): minimum `text-sm px-3 py-1`. Never `text-xs` for clickable buttons.
- **Icons inside buttons**: minimum `w-3.5 h-3.5`. Never `w-3 h-3` for interactive icons.
- **Label text** in tooltips and sidebar sections: `text-sm` minimum. `text-xs` only for metadata labels (e.g. "CONFLICTS WITH" uppercase tags), never for body copy.
- **Descriptive/body text** anywhere (tooltips, conflict descriptions, hints, sidebar copy): always `text-sm`. Never `text-xs` for readable content.

These rules exist because the user has been repeatedly frustrated by tiny unclickable UI elements and unreadable text. Do not ship `text-xs` for any content text, ever.

## Stack

- React + TypeScript, Vite
- React Flow (XYFlow) for the canvas
- Zustand-style graph store in `src/store/` with localStorage persistence
- Tailwind v4 (`@import "tailwindcss"` — no `tailwind.config.js`; dark mode via `dark:` prefix)
- Lucide icons

## Key conventions

- Node data lives in `ThonkNode` (`src/store/types.ts`). Mutations go through `updateNode()` from `useGraph`.
- All AI calls go through `src/ai/gemini.ts` via `callAI()`. New functions follow the existing pattern: system prompt constant, exported async function, response schema.
- React Flow nodes must mark interactive elements with `className="nodrag"` to prevent drag interference.
- `NodeToolbar` must be rendered **outside** `NodeShell` (sibling, not child) — placing it inside breaks positioning.
