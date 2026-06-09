const MODEL_LITE  = 'gemini-3.1-flash-lite'
const MODEL_SMART = 'gemini-3.5-flash'

const STORAGE_KEY     = 'thonk.apikey'
const STORAGE_HI_KEY  = 'thonk.highiq'

export function getApiKey(): string {
  return localStorage.getItem(STORAGE_KEY) ?? ''
}

export function setApiKey(key: string): void {
  localStorage.setItem(STORAGE_KEY, key)
}

export function getHighIQ(): boolean {
  return localStorage.getItem(STORAGE_HI_KEY) === '1'
}

export function setHighIQ(on: boolean): void {
  localStorage.setItem(STORAGE_HI_KEY, on ? '1' : '0')
}

function getApiBase(): string {
  const model = getHighIQ() ? MODEL_SMART : MODEL_LITE
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`
}

interface GeminiRequest {
  systemInstruction: string
  userPrompt: string
  responseSchema: object
}

async function callGemini<T>(req: GeminiRequest): Promise<T> {
  const key = getApiKey()
  if (!key) throw new Error('No Gemini API key set. Add your key in the top bar.')

  const body = {
    systemInstruction: { parts: [{ text: req.systemInstruction }] },
    contents: [{ role: 'user', parts: [{ text: req.userPrompt }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: req.responseSchema,
    },
  }

  const res = await fetch(`${getApiBase()}?key=${key}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Gemini error ${res.status}: ${err}`)
  }

  const data = await res.json()
  const text: string = data.candidates[0].content.parts[0].text
  return JSON.parse(text) as T
}

// ── Critique pass ─────────────────────────────────────────────────────────────

export interface CritiqueItem {
  content: string
  severity: number
  kind: 'contradiction' | 'gap' | 'assumption' | 'factual'
}

const CRITIQUE_SCHEMA = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      content: { type: 'string' },
      severity: { type: 'number' },
      kind: { type: 'string', enum: ['contradiction', 'gap', 'assumption', 'factual'] },
    },
    required: ['content', 'severity', 'kind'],
  },
}

const CRITIQUE_SYSTEM = `You are a smart, skeptical person who just read this idea and immediately noticed something wrong.
Identify the most direct, natural problems — the kind a thoughtful person would voice out loud right after reading.
Short sentences. Plain language. No formal analysis, no jargon.
Think: "But that assumes...", "What happens when...", "This falls apart if...", "Who would actually..."
Score each problem 0.0–1.0. Return empty array if the idea holds up. Do NOT invent weak problems to fill space.
Each problem: 1–2 sentences max.`

const SEVERITY_THRESHOLD = 0.5

export async function critiqueNode(contextPrompt: string): Promise<CritiqueItem[]> {
  const items = await callGemini<CritiqueItem[]>({
    systemInstruction: CRITIQUE_SYSTEM,
    userPrompt: contextPrompt,
    responseSchema: CRITIQUE_SCHEMA,
  })
  return items.filter(i => i.severity >= SEVERITY_THRESHOLD)
}

// ── Question pass ─────────────────────────────────────────────────────────────

export interface QuestionItem {
  question: string
}

const QUESTION_SCHEMA = {
  type: 'object',
  properties: {
    question: { type: 'string' },
  },
  required: ['question'],
}

const QUESTION_SYSTEM = `You are someone who just read a note and immediately thought of a question.
Write the single most obvious follow-up question — the thing a curious person would actually say out loud.
Short. Direct. Conversational. No jargon. Think "How?" not "How will the system ensure...?"
Often the best questions are just one or two words: "How exactly?", "Why not X?", "What's the catch?", "Compared to what?"
Return only the question. No preamble.`

export async function questionNode(contextPrompt: string): Promise<QuestionItem> {
  return callGemini<QuestionItem>({
    systemInstruction: QUESTION_SYSTEM,
    userPrompt: contextPrompt,
    responseSchema: QUESTION_SCHEMA,
  })
}

// ── Generation pass ───────────────────────────────────────────────────────────

export interface IdeaItem {
  title: string
  body: string
}

const IDEA_SCHEMA = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      title: { type: 'string' },
      body: { type: 'string' },
    },
    required: ['title', 'body'],
  },
}

const EXPAND_SYSTEM = `You are a creative strategist helping develop ideas on an ideation board.
The BOARD SKELETON shows ALL ideas that already exist — do not duplicate or paraphrase any of them.
Generate 3 new, concrete ideas that genuinely extend or build upon the TARGET NODE.
Each idea must be distinct from everything in the skeleton. Avoid generic brainstorming platitudes.
Keep titles under 60 characters. Bodies should be 1-2 sentences.`

const PROPOSE_SYSTEM = `You are a creative strategist helping find new ideas related to a concept.
The BOARD SKELETON shows ALL ideas that already exist — do not duplicate or paraphrase any of them.
Generate 3 concrete sibling ideas — related to the TARGET NODE's domain but approaching it from different angles.
Each idea must be distinct from everything in the skeleton.
Keep titles under 60 characters. Bodies should be 1-2 sentences.`

export async function expandNode(contextPrompt: string): Promise<IdeaItem[]> {
  return callGemini<IdeaItem[]>({
    systemInstruction: EXPAND_SYSTEM,
    userPrompt: contextPrompt,
    responseSchema: IDEA_SCHEMA,
  })
}

export async function proposeIdeas(contextPrompt: string): Promise<IdeaItem[]> {
  return callGemini<IdeaItem[]>({
    systemInstruction: PROPOSE_SYSTEM,
    userPrompt: contextPrompt,
    responseSchema: IDEA_SCHEMA,
  })
}

// ── Summary ───────────────────────────────────────────────────────────────────

const SUMMARY_SYSTEM = `You are a precise summarizer.
Write exactly 1-2 sentences capturing the core insight of this idea/description.
Be concrete and specific — no filler like "this section discusses" or "this explores".
The summary will be shown as a preview on an ideation card.`

export async function generateSummary(title: string, body: string): Promise<string> {
  const result = await callGemini<{ summary: string }>({
    systemInstruction: SUMMARY_SYSTEM,
    userPrompt: `Title: ${title}\n\n${body}`,
    responseSchema: {
      type: 'object',
      properties: { summary: { type: 'string' } },
      required: ['summary'],
    },
  })
  return result.summary
}

// ── Integrate Q&A into node body ──────────────────────────────────────────────

const INTEGRATE_SYSTEM = `You are a documentation writer for an ideation mind map.
Receive: a node (title + body), a question asked about it, and the answer given.
Task: rewrite the body incorporating the new knowledge.

FORMAT — follow strictly:
- Bullet points only. No prose paragraphs.
- Each bullet = one concrete fact, constraint, or insight.
- Nested bullets for supporting detail.
- 4–8 top-level bullets maximum. Be terse.
- Never start with filler phrases ("This idea...", "Note that...", "It is worth...").

CROSS-REFERENCES:
- When referencing another node from the BOARD SKELETON, link it: [Node Title](node:NODE_ID)
  The NODE_ID is the full UUID in the first brackets of each skeleton entry.
- Only link nodes that are genuinely conceptually related — not just adjacent.

TITLE: Only provide a new title if the answer fundamentally renames the concept (under 60 chars). Otherwise leave blank.`

export async function integrateQA(
  contextPrompt: string,
  question: string,
  answer: string,
): Promise<{ body: string; title?: string }> {
  return callGemini<{ body: string; title?: string }>({
    systemInstruction: INTEGRATE_SYSTEM,
    userPrompt: `${contextPrompt}\n\nQUESTION ASKED: ${question}\nANSWER PROVIDED: ${answer}`,
    responseSchema: {
      type: 'object',
      properties: {
        body:  { type: 'string' },
        title: { type: 'string' },
      },
      required: ['body'],
    },
  })
}

export async function integrateAllQA(
  contextPrompt: string,
  pairs: Array<{ question: string; answer: string }>,
): Promise<{ body: string; title?: string }> {
  const pairsText = pairs
    .map((p, i) => `Q${i + 1}: ${p.question}\nA${i + 1}: ${p.answer}`)
    .join('\n\n')
  return callGemini<{ body: string; title?: string }>({
    systemInstruction: INTEGRATE_SYSTEM,
    userPrompt: `${contextPrompt}\n\n${pairsText}`,
    responseSchema: {
      type: 'object',
      properties: {
        body:  { type: 'string' },
        title: { type: 'string' },
      },
      required: ['body'],
    },
  })
}

// ── Conflict detection ────────────────────────────────────────────────────────

const CONFLICT_SCHEMA = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      nodeId:      { type: 'string' },
      description: { type: 'string' },
    },
    required: ['nodeId', 'description'],
  },
}

const CONFLICT_SYSTEM = `You are a consistency checker for an ideation board.
You receive a recently updated node and a list of other nodes on the board.
Find genuine logical contradictions — where the updated node's content directly conflicts with another node.
Only flag direct, non-trivial contradictions. Ignore: missing detail, different angles, or complementary ideas.
Use the exact nodeId values from the list in the nodeId field.
In the description, refer to other nodes by their title (never by their ID).
Return an empty array if no real contradictions exist.`

export interface ConflictItem {
  nodeId: string
  description: string
}

export async function detectConflicts(
  updatedTitle: string,
  updatedBody: string,
  otherNodes: Array<{ id: string; type: string; title: string; body: string; summary: string }>,
): Promise<ConflictItem[]> {
  if (otherNodes.length === 0) return []
  const others = otherNodes
    .map(n => `[${n.id}] (${n.type}) "${n.title}": ${n.summary || n.body.slice(0, 200)}`)
    .join('\n')
  const items = await callGemini<ConflictItem[]>({
    systemInstruction: CONFLICT_SYSTEM,
    userPrompt: `UPDATED NODE:\nTitle: ${updatedTitle}\nBody: ${updatedBody}\n\nOTHER NODES:\n${others}`,
    responseSchema: CONFLICT_SCHEMA,
  })
  // Replace any raw IDs that slipped into descriptions with the node's title
  return items.map(item => ({
    ...item,
    description: otherNodes.reduce(
      (desc, n) => desc.replace(new RegExp(n.id.slice(0, 8), 'g'), `"${n.title}"`),
      item.description,
    ),
  }))
}

// ── Board propagation: find unconnected nodes that should absorb the insight ──

const PROPAGATE_SCHEMA = {
  type: 'array',
  items: {
    type: 'object',
    properties: { nodeId: { type: 'string' } },
    required: ['nodeId'],
  },
}

const PROPAGATE_SYSTEM = `You are a knowledge propagation assistant for an ideation board.
A Q&A was just approved, enriching one idea node with new knowledge.
Given a board skeleton, identify UP TO 3 other idea/core/problem nodes (not directly connected to the updated node) that would meaningfully benefit from this same insight.
Only return nodes where the insight genuinely changes or extends their content — not just tangentially related.
Return an empty array if no other nodes are affected.
Use exact nodeId values from the board.`

export async function findRelatedNodes(
  question: string,
  answer: string,
  updatedNodeId: string,
  otherNodes: Array<{ id: string; type: string; title: string; summary: string }>,
): Promise<string[]> {
  if (otherNodes.length === 0) return []
  const skeleton = otherNodes
    .map(n => `[${n.id}] (${n.type}) "${n.title}": ${n.summary}`)
    .join('\n')
  const result = await callGemini<Array<{ nodeId: string }>>({
    systemInstruction: PROPAGATE_SYSTEM,
    userPrompt: `Q: ${question}\nA: ${answer}\n\nUPDATED NODE ID: ${updatedNodeId}\n\nBOARD:\n${skeleton}`,
    responseSchema: PROPAGATE_SCHEMA,
  })
  return result.map(r => r.nodeId).filter(id => id !== updatedNodeId)
}

// ── Argue (critique variant with fix framing) ─────────────────────────────────

const ARGUE_SYSTEM = `You are a sharp reader who just heard this answer and immediately pushed back.
Identify the most natural, direct problems — what a smart skeptic would say out loud right after reading.
Short sentences. Plain language. No formal analysis.
Think: "But that doesn't explain...", "That only works if...", "You're ignoring...", "This breaks when..."
Score 0.0–1.0. Return empty array if no real problems exist.
Each problem: 1–2 sentences max.`

export async function argueNode(contextPrompt: string): Promise<CritiqueItem[]> {
  const items = await callGemini<CritiqueItem[]>({
    systemInstruction: ARGUE_SYSTEM,
    userPrompt: contextPrompt,
    responseSchema: CRITIQUE_SCHEMA,
  })
  return items.filter(i => i.severity >= SEVERITY_THRESHOLD)
}

// ── AI-generated answer ───────────────────────────────────────────────────────

const ANSWER_SYSTEM = `You are a sharp colleague giving a quick, honest take on a question.
One or two short sentences. Casual, direct — like a Slack message, not a report.
Leave room for follow-up. Don't wrap it up, just answer the core of what was asked.
No hedging, no filler, no summaries, no "in conclusion".`

export async function answerQuestion(contextPrompt: string): Promise<{ answer: string }> {
  return callGemini<{ answer: string }>({
    systemInstruction: ANSWER_SYSTEM,
    userPrompt: contextPrompt,
    responseSchema: {
      type: 'object',
      properties: { answer: { type: 'string' } },
      required: ['answer'],
    },
  })
}

// ── Correct an answer based on user-pointed mistakes ─────────────────────────

const CORRECT_ANSWER_SYSTEM = `You are a sharp colleague revising a quick answer after a correction.
One or two short sentences. Casual and direct — incorporate the correction, nothing else.
No preamble, no meta-commentary, no "you're right", no summaries.`

export async function correctAnswer(
  contextPrompt: string,
  originalAnswer: string,
  correction: string,
): Promise<{ answer: string }> {
  return callGemini<{ answer: string }>({
    systemInstruction: CORRECT_ANSWER_SYSTEM,
    userPrompt: `${contextPrompt}\n\nORIGINAL ANSWER: ${originalAnswer}\n\nUSER CORRECTION: ${correction}`,
    responseSchema: {
      type: 'object',
      properties: { answer: { type: 'string' } },
      required: ['answer'],
    },
  })
}
