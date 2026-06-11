import type { GroundingChunk, ThonkGraph } from '@/store/types'

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

interface SearchCallRequest {
  systemInstruction: string
  userPrompt: string
}

interface SearchResult {
  text: string
  sources: GroundingChunk[]
}

async function callGeminiWithSearch(req: SearchCallRequest): Promise<SearchResult> {
  const key = getApiKey()
  if (!key) throw new Error('No Gemini API key set. Add your key in the top bar.')

  const makeBody = (withSearch: boolean) => ({
    systemInstruction: { parts: [{ text: withSearch ? req.systemInstruction : req.systemInstruction + '\nDo not include any URLs or links in your response.' }] },
    contents: [{ role: 'user', parts: [{ text: req.userPrompt }] }],
    ...(withSearch ? { tools: [{ googleSearch: {} }] } : {}),
  })

  let res = await fetch(`${getApiBase()}?key=${key}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(makeBody(true)),
  })

  // Grounded search has a separate quota — fall back to plain prompt on 429
  if (res.status === 429) {
    res = await fetch(`${getApiBase()}?key=${key}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(makeBody(false)),
    })
  }

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Gemini error ${res.status}: ${err}`)
  }

  const data = await res.json()
  const text: string = data.candidates[0].content.parts[0].text
  const chunks: Array<{ web?: { title?: string; uri?: string } }> =
    data.candidates[0].groundingMetadata?.groundingChunks ?? []
  const sources: GroundingChunk[] = chunks
    .filter(c => c.web?.uri)
    .map(c => ({ title: c.web!.title ?? c.web!.uri!, uri: c.web!.uri! }))
    .slice(0, 5)
  return { text, sources }
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
Score each problem 0.0–1.0. Return only problems that genuinely arise from this specific content. Return empty array if the idea holds up.
Do NOT pad to reach a number. Do NOT invent problems. If one real problem exists, return one. If four exist, return four.
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
  yesNo: boolean
}

const QUESTION_SCHEMA = {
  type: 'object',
  properties: {
    question: { type: 'string' },
    yesNo:    { type: 'boolean', description: 'true if the question can be answered with Yes or No' },
  },
  required: ['question', 'yesNo'],
}

const QUESTION_SYSTEM = `You are someone who just read a note and immediately thought of a question.
Write the single most obvious follow-up question — the thing a curious person would actually say out loud.
Short. Direct. Conversational. No jargon. Think "How?" not "How will the system ensure...?"
Often the best questions are just one or two words: "How exactly?", "Why not X?", "What's the catch?", "Compared to what?"
Do not ask about anything already answered or addressed in the node body.
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

const IDEA_TONE = `
TONE — this is critical:
- Match the voice and register of the existing content exactly.
- If the notes are casual and personal, write casually. If they're technical or formal, match that.
- Never impose a tone that doesn't match the source — don't formalize casual content or casualize formal content.
- Write like the person who wrote the original notes — same vocabulary, same energy.`

const EXPAND_SYSTEM = `You are helping develop ideas on an ideation board.
The BOARD SKELETON shows ALL ideas that already exist — do not duplicate or paraphrase any of them.
Generate however many new, concrete ideas naturally extend or build upon the TARGET NODE — no fixed count.
If the content strongly suggests one direction, return one. If it opens several distinct threads, return several.
Do NOT pad to reach a number. Each idea must earn its place.
Each idea must be distinct from everything in the skeleton. Avoid generic brainstorming platitudes.
Keep titles under 60 characters. Bodies should be 1-2 sentences.
${IDEA_TONE}`

const PROPOSE_SYSTEM = `You are helping find new ideas related to a concept on an ideation board.
The BOARD SKELETON shows ALL ideas that already exist — do not duplicate or paraphrase any of them.
Generate however many sibling ideas naturally emerge — related to the TARGET NODE's domain but approaching it from different angles.
No fixed count. If one strong angle exists, return one. If several distinct approaches arise, return several.
Do NOT pad to reach a number. Each idea must earn its place.
Each idea must be distinct from everything in the skeleton.
Keep titles under 60 characters. Bodies should be 1-2 sentences.
${IDEA_TONE}`

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

const INTEGRATE_SYSTEM = `You are updating a personal note on an ideation board.
Receive: a node (title + body), a question asked about it, and the answer given.
Task: rewrite the body incorporating the new knowledge.

TONE — this is critical:
- Match the voice and register of the existing content exactly.
- If the note is casual and personal ("thinking about moving", "not sure yet"), write casually.
- If it's technical or formal, match that. Never impose a formal, corporate, or robotic tone onto casual content.
- Write like the person who wrote the original note would write it — same vocabulary, same energy.

FORMAT — proper markdown:
- Bullet lists for facts, thoughts, constraints. Each bullet on its own line starting with "- ".
- NEVER put multiple bullets on one line separated by " - ". Every bullet must start on a new line.
- Use ## headings only when content naturally falls into distinct sections — not for a single topic.
- Each bullet = 1–2 sentences max. Be terse.
- No filler openers ("This idea...", "Note that...", "It is worth...").
- No top-level title — the node already has one.

CROSS-REFERENCES:
- You may link to IDEA nodes from the BOARD SKELETON using: [Node Title](node:NODE_ID)
  The NODE_ID is the full UUID in the first brackets of each skeleton entry.
- Only link ideas that are genuinely conceptually related — not just adjacent.
- Do NOT link to questions, answers, problems, or core nodes — ideas only.

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

const INTEGRATE_IDEA_SYSTEM = `You are updating a personal note on an ideation board.
Receive: a node (title + body) and one specific idea being merged into it.
Task: rewrite the body incorporating ONLY the content of the provided idea. Do not pull in, summarize, or reference other nodes visible in the board skeleton — they are context only, not input.

TONE — this is critical:
- Match the voice and register of the existing content exactly.
- If the note is casual and personal, write casually. If technical, match that.

FORMAT — proper markdown:
- Bullet lists for facts, thoughts, constraints. Each bullet on its own line starting with "- ".
- NEVER put multiple bullets on one line separated by " - ".
- Use ## headings only when content naturally falls into distinct sections.
- Each bullet = 1–2 sentences max. Be terse.
- No filler openers. No top-level title.

TITLE: Only provide a new title if the idea fundamentally renames the concept (under 60 chars). Otherwise leave blank.`

export async function integrateIdea(
  contextPrompt: string,
  ideaTitle: string,
  ideaBody: string,
): Promise<{ body: string; title?: string }> {
  return callGemini<{ body: string; title?: string }>({
    systemInstruction: INTEGRATE_IDEA_SYSTEM,
    userPrompt: `${contextPrompt}\n\nIDEA BEING MERGED: ${ideaTitle}\nIDEA CONTENT: ${ideaBody}`,
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

const ACKNOWLEDGE_PROBLEM_SYSTEM = `You are updating a personal note on an ideation board.
Receive: a node (title + body) and a problem/concern that has been raised about it and is now being acknowledged.
Task: briefly note this concern in the body — as a known limitation, caveat, or addressed issue. Add at most 1–2 short sentences.
Rules:
- Do not solve the problem or elaborate extensively — just acknowledge it exists or has been considered.
- Only integrate the provided problem. Do not pull in other nodes visible in the board skeleton.
- Match the voice and tone of the existing content exactly.
- No filler openers ("Note that...", "It is worth...").
- No top-level title.
TITLE: Only provide a new title if the concern fundamentally reframes the concept (under 60 chars). Otherwise leave blank.`

export async function acknowledgeProblem(
  contextPrompt: string,
  problemTitle: string,
  problemBody: string,
): Promise<{ body: string; title?: string }> {
  return callGemini<{ body: string; title?: string }>({
    systemInstruction: ACKNOWLEDGE_PROBLEM_SYSTEM,
    userPrompt: `${contextPrompt}\n\nPROBLEM BEING ACKNOWLEDGED: ${problemTitle}\nPROBLEM DETAIL: ${problemBody}`,
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

const REJECT_IDEA_SYSTEM = `You are updating a personal note on an ideation board.
An idea that was spawned from it is being rejected.
If the idea's content was already integrated into the body, remove that integration first.
Then append one brief sentence noting the idea was considered and rejected.
Rules: one added sentence max. Start with "Considered " or "Explored ". Do not editorialize.
Format: return the full updated body only.`

export async function rejectIdea(
  contextPrompt: string,
  ideaTitle: string,
  ideaBody: string,
): Promise<{ body: string }> {
  return callGemini<{ body: string }>({
    systemInstruction: REJECT_IDEA_SYSTEM,
    userPrompt: `${contextPrompt}\n\nREJECTED IDEA: ${ideaTitle}\nIDEA CONTENT: ${ideaBody}`,
    responseSchema: {
      type: 'object',
      properties: { body: { type: 'string' } },
      required: ['body'],
    },
  })
}

const REJECTION_SYSTEM = `You are updating a personal note on an ideation board.
Receive: a node (title + body), a question that was asked, and an answer that was rejected.
The answer may have already been integrated into the body — if so, remove that integration first.
Task: rewrite the body removing any content that came from the rejected answer, then append one brief sentence noting it was considered and rejected.
Rules: preserve all content that did NOT come from the rejected answer. One added sentence max. Start with "Considered " or "Explored ". Do not editorialize.
Format: return the full updated body only.`

export async function integrateRejection(
  contextPrompt: string,
  question: string,
  rejectedAnswer: string,
): Promise<{ body: string }> {
  return callGemini<{ body: string }>({
    systemInstruction: REJECTION_SYSTEM,
    userPrompt: `${contextPrompt}\n\nQUESTION ASKED: ${question}\nREJECTED ANSWER: ${rejectedAnswer}`,
    responseSchema: {
      type: 'object',
      properties: { body: { type: 'string' } },
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

const ANSWER_SYSTEM = `You are a knowledgeable assistant in an ideation session.
Answer with the fewest words that fully cover the question — one sentence if it's enough, two if genuinely needed, never more.
Do not pad. Do not add context the question didn't ask for. Stop as soon as the answer is complete.
Use web search when the question benefits from current or factual information.
No preamble, no filler, no sign-off.
Match the tone and voice of the existing content exactly — casual content gets a casual answer, formal content gets a formal one.
If existing answers are already connected to this question (visible in context), provide a different angle — do not repeat what's already there.`

export async function answerQuestion(contextPrompt: string): Promise<{ answer: string; sources: GroundingChunk[] }> {
  const result = await callGeminiWithSearch({ systemInstruction: ANSWER_SYSTEM, userPrompt: contextPrompt })
  return { answer: result.text, sources: result.sources }
}

const SOLUTION_SYSTEM = `You are a direct, practical colleague in a brainstorming session.
Propose one concrete solution or next step. One sentence if it's enough — stop there.
No analysis, no restating the problem, no preamble, no elaboration beyond the solution itself.
Match the tone of the content — casual stays casual.
If existing solutions are already connected to this problem (visible in context), provide a different approach — do not repeat what's already there.`

export async function generateSolution(contextPrompt: string): Promise<{ answer: string; sources: GroundingChunk[] }> {
  const result = await callGeminiWithSearch({ systemInstruction: SOLUTION_SYSTEM, userPrompt: contextPrompt })
  return { answer: result.text, sources: result.sources }
}

// ── Correct an answer based on user-pointed mistakes ─────────────────────────

const CORRECT_ANSWER_SYSTEM = `You are a sharp colleague revising a quick answer after a correction.
One or two short sentences. Casual and direct — incorporate the correction, nothing else.
No preamble, no meta-commentary, no "you're right", no summaries.`

// ── Brief generation ─────────────────────────────────────────────────────────

const BRIEF_SYSTEM = `You are arranging, not writing. Use the actual words from the nodes as much as possible — quote them, combine them, trim them. Do not rewrite in your own voice.
Your only job is to order the ideas so they flow and cut what's redundant. Add a word or two of connective tissue only when something would be incomprehensible without it.
The output should read like the person's own words put in order, not a paraphrase.
No intro sentence, no outro, no meta-commentary. Just the ideas.
No top-level title — return that separately.`

export async function generateBrief(
  graph: ThonkGraph,
  apiKey: string,
): Promise<{ title: string; markdown: string }> {
  const sourceNodes = graph.nodes.filter(n => n.type === 'core' || n.type === 'idea')

  if (!apiKey || !sourceNodes.length) {
    const fallback = sourceNodes
      .map(n => `## ${n.title}\n\n${n.body || '*No content yet.*'}`)
      .join('\n\n---\n\n')
    return {
      title: sourceNodes[0]?.title || 'Untitled',
      markdown: fallback,
    }
  }

  const nodeLines = sourceNodes
    .map(n => `[${n.type}] "${n.title}"\n${n.body || ''}`)
    .join('\n\n')

  const sourceIds = new Set(sourceNodes.map(n => n.id))
  const edgeLines = graph.edges
    .filter(e => sourceIds.has(e.source) && sourceIds.has(e.target))
    .map(e => {
      const src = sourceNodes.find(n => n.id === e.source)?.title ?? e.source
      const tgt = sourceNodes.find(n => n.id === e.target)?.title ?? e.target
      return `"${src}" --${e.relation}--> "${tgt}"`
    })
    .join('\n')

  const userPrompt = `NODES:\n${nodeLines}${edgeLines ? `\n\nCONNECTIONS:\n${edgeLines}` : ''}`

  const key = apiKey
  const model = getHighIQ() ? MODEL_SMART : MODEL_LITE
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`

  const body = {
    systemInstruction: { parts: [{ text: BRIEF_SYSTEM }] },
    contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'object',
        properties: {
          title:    { type: 'string' },
          markdown: { type: 'string' },
        },
        required: ['title', 'markdown'],
      },
    },
  }

  const res = await fetch(url, {
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
  return JSON.parse(text) as { title: string; markdown: string }
}

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
