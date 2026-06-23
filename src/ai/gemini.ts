import type { ThonkGraph } from '@/store/types'
import type { AIRequest, Provider } from './types'
import { callOpenAICompat, callOpenAISearch, type OAICompatProvider } from './openai-compat'
import { callAnthropic, callAnthropicSearch } from './anthropic'

interface GroundingChunk { title: string; uri: string }

// ── Models ────────────────────────────────────────────────────────────────────

const MODEL_LITE  = 'gemini-3.1-flash-lite'
const MODEL_SMART = 'gemini-3.5-flash'

// ── Storage keys ──────────────────────────────────────────────────────────────

const STORAGE_KEY           = 'thonk.apikey'
const STORAGE_HI_KEY        = 'thonk.highiq'
const STORAGE_PROVIDER      = 'thonk.provider'
const STORAGE_WEBSEARCH_KEY = 'thonk.websearch'

// ── Provider helpers ─────────────────────────────────────────────────────────

export function getProvider(): Provider {
  return (localStorage.getItem(STORAGE_PROVIDER) as Provider) ?? 'gemini'
}

export function setProvider(p: Provider): void {
  localStorage.setItem(STORAGE_PROVIDER, p)
}

export function getProviderKey(p: Provider): string {
  if (p === 'gemini') return localStorage.getItem(STORAGE_KEY) ?? ''
  return localStorage.getItem(`thonk.apikey.${p}`) ?? ''
}

export function setProviderKey(p: Provider, key: string): void {
  if (p === 'gemini') {
    localStorage.setItem(STORAGE_KEY, key)
    return
  }
  localStorage.setItem(`thonk.apikey.${p}`, key)
}

export function hasActiveKey(): boolean {
  const p = getProvider()
  if (p === 'ollama') {
    const base = localStorage.getItem('thonk.ollama.baseurl') ?? 'http://localhost:11434/v1'
    if (base.startsWith('http://localhost') || base.startsWith('http://127.')) return true
    return !!(localStorage.getItem('thonk.apikey.ollama') ?? '')
  }
  return !!getProviderKey(p)
}

// ── Gemini-specific key/model helpers (kept for backward compat) ──────────────

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

export function getWebSearch(): boolean {
  return localStorage.getItem(STORAGE_WEBSEARCH_KEY) !== '0'
}

export function setWebSearch(on: boolean): void {
  localStorage.setItem(STORAGE_WEBSEARCH_KEY, on ? '1' : '0')
}

function getApiBase(): string {
  const model = getHighIQ() ? MODEL_SMART : MODEL_LITE
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`
}

// ── Gemini internal fetcher ───────────────────────────────────────────────────

async function _callGemini<T>(req: AIRequest): Promise<T> {
  const key = getApiKey()
  if (!key) throw new Error('No API key set. Add your key in the top bar.')

  const body = {
    systemInstruction: { parts: [{ text: req.systemInstruction }] },
    contents: [{ role: 'user', parts: [{ text: req.userPrompt }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: req.responseSchema,
      ...(req.maxTokens ? { maxOutputTokens: req.maxTokens } : {}),
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
  if (!data.candidates?.length) throw new Error('Gemini returned no candidates — content may have been blocked by safety filters.')
  const text: string = data.candidates[0].content.parts[0].text
  return JSON.parse(text) as T
}

// ── Provider dispatcher ───────────────────────────────────────────────────────

async function callAI<T>(req: AIRequest): Promise<T> {
  const p = getProvider()
  if (p === 'anthropic') return callAnthropic<T>(req)
  if (p === 'openai' || p === 'deepseek' || p === 'ollama') return callOpenAICompat<T>(p as OAICompatProvider, req)
  return _callGemini<T>(req)
}

// ── Grounded search (Gemini only; others fall back to plain text) ─────────────

interface SearchCallRequest {
  systemInstruction: string
  userPrompt: string
  maxTokens?: number
}

interface SearchResult {
  text: string
  sources: GroundingChunk[]
}

async function _callGeminiWithSearch(req: SearchCallRequest): Promise<SearchResult> {
  const key = getApiKey()
  if (!key) throw new Error('No API key set. Add your key in the top bar.')

  const makeBody = (withSearch: boolean) => ({
    systemInstruction: { parts: [{ text: withSearch ? req.systemInstruction : req.systemInstruction + '\nDo not include any URLs or links in your response.' }] },
    contents: [{ role: 'user', parts: [{ text: req.userPrompt }] }],
    ...(withSearch ? { tools: [{ googleSearch: {} }] } : {}),
    ...(req.maxTokens ? { generationConfig: { maxOutputTokens: req.maxTokens } } : {}),
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
  if (!data.candidates?.length) throw new Error('Gemini returned no candidates — content may have been blocked by safety filters.')
  const text: string = data.candidates[0].content.parts[0].text
  const chunks: Array<{ web?: { title?: string; uri?: string } }> =
    data.candidates[0].groundingMetadata?.groundingChunks ?? []
  const sources: GroundingChunk[] = chunks
    .filter(c => c.web?.uri)
    .map(c => ({ title: c.web!.title ?? c.web!.uri!, uri: c.web!.uri! }))
    .slice(0, 5)
  return { text, sources }
}

const NATURALIZE_SYSTEM = `You are a text editor. Clean up the input text:
- Remove all markdown link syntax and bare URLs
- If a source domain name appears as a citation, weave it into the sentence naturally (e.g. "according to macrumors.com") — only if it fits naturally, otherwise drop it
- Preserve the original length and all information
Output only the cleaned text, nothing else.`

async function naturalizeSearchText(raw: string): Promise<string> {
  const result = await callAI<{ text: string }>({
    systemInstruction: NATURALIZE_SYSTEM,
    userPrompt: raw,
    responseSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
  })
  return result.text
}


async function callAISearch(req: SearchCallRequest): Promise<SearchResult> {
  const p = getProvider()
  const augmented: SearchCallRequest = {
    ...req,
    systemInstruction: req.systemInstruction + '\nRespond directly. Never open with first-person preamble like "I need to search", "I\'ll look up", "I found", or similar.',
  }
  let result: SearchResult
  if (getWebSearch()) {
    if (p === 'gemini') result = await _callGeminiWithSearch(augmented)
    else if (p === 'anthropic') result = { text: await naturalizeSearchText(await callAnthropicSearch(augmented)), sources: [] }
    else if (p === 'openai') result = { text: await naturalizeSearchText(await callOpenAISearch(augmented)), sources: [] }
    else result = { text: '', sources: [] }
  } else {
    const r = await callAI<{ answer: string }>({
      systemInstruction: augmented.systemInstruction,
      userPrompt: req.userPrompt,
      responseSchema: { type: 'object', properties: { answer: { type: 'string' } }, required: ['answer'] },
      maxTokens: req.maxTokens,
    })
    result = { text: r.answer, sources: [] }
  }
  return result
}

// ── Source document digest ────────────────────────────────────────────────────

const SOURCE_DIGEST_SYSTEM = `You are a document analyst. Given a document's text, return a JSON object with:
- title: A concise plain-text title under 50 characters. No quotes, no filler words like "Document about…".
- digest: A ~1024-character distillation capturing the document's spine, key decisions, and core constraints. Write a synthesis, not a truncation. Dense, specific, no filler phrases.`

export async function digestSource(fullText: string): Promise<{ title: string; digest: string }> {
  const result = await callAI<{ title: string; digest: string }>({
    systemInstruction: SOURCE_DIGEST_SYSTEM,
    userPrompt: `Document text:\n\n${fullText.slice(0, 24000)}`,
    responseSchema: {
      type: 'object',
      properties: {
        title:  { type: 'string' },
        digest: { type: 'string' },
      },
      required: ['title', 'digest'],
    },
  })
  result.title = result.title.slice(0, 50).replace(/^["'\s]+|["'\s]+$/g, '').trim()
  if (!result.title) result.title = 'Source'
  return result
}

// ── Grammar fix ───────────────────────────────────────────────────────────────

export async function fixGrammar(text: string): Promise<{ fixed: string }> {
  return callAI<{ fixed: string }>({
    systemInstruction: `You are a minimal text corrector. Fix spelling, apply sentence case, and add missing punctuation.

Rules — follow all strictly:
- Fix obvious typos and misspellings
- Apply sentence case: capitalize only the first word and proper nouns; lowercase everything else
- Add missing colons, commas, question marks, or periods where clearly needed
- Do NOT rephrase, reorder, or restructure anything
- Do NOT add or remove words unless correcting a clear error
- Do NOT add em dashes, long dashes, or hyphens
- Do NOT add emojis or symbols
- Preserve the original tone, brevity, and style`,
    userPrompt: text,
    responseSchema: {
      type: 'object',
      properties: { fixed: { type: 'string' } },
      required: ['fixed'],
    },
    maxTokens: 200,
  })
}

// ── Critique pass ─────────────────────────────────────────────────────────────

export interface CritiqueItem {
  content: string
  severity: number
}

const CRITIQUE_SCHEMA = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      content: { type: 'string' },
      severity: { type: 'number', description: '0.0 = negligible, 1.0 = fatal flaw' },
    },
    required: ['content', 'severity'],
  },
}

const NO_DISCLAIMER_BLOCK = `Never explain what you as an AI cannot do. Never disclaim your AI nature or capabilities. Treat yourself as a knowledgeable colleague — if a question touches something physical or outside a typical AI scope, give the best practical advice anyway.`

const UNITS_BLOCK = /^en-US\b/.test(navigator.language)
  ? 'Use imperial units (inches, feet, miles, °F) when giving measurements.'
  : 'Use metric units (cm, m, km, °C) when giving measurements.'

const CRITIQUE_SYSTEM = `You are a smart, skeptical person evaluating an idea or decision.
Your job is to find real problems with the SUBSTANCE — the claim, the design decision, the assumption being made — not the quality or length of the text.
NEVER comment on vagueness, brevity, or lack of explanation. "Too vague" is not a problem. "Doesn't clarify" is not a problem. Attack the idea itself.
If the TARGET NODE is short (e.g. "The game." or "Yes."), read it together with CONNECTED NODES to reconstruct the full claim. "The game." answering "who controls the sarcasm?" means the claim is "the game controls the sarcasm" — critique that design decision, not the phrasing.
Every problem must be directly grounded in the TARGET NODE and its CONNECTED NODES only. Do not import concerns from unrelated parts of the board.
Short sentences. Plain language. Think: "But that assumes...", "What happens when...", "This falls apart if...", "Who would actually..."
Score each problem 0.0–1.0: 0.3 = minor concern, 0.6 = significant problem, 0.9 = near-fatal flaw. Return empty array if the idea holds up.
Do NOT pad. Return at most 3 problems — the most significant only. Each problem: one short sentence. No elaboration.
${NO_DISCLAIMER_BLOCK}`

const SEVERITY_THRESHOLD = 0.5

export async function critiqueNode(contextPrompt: string): Promise<CritiqueItem[]> {
  const items = await callAI<CritiqueItem[]>({
    systemInstruction: CRITIQUE_SYSTEM,
    userPrompt: contextPrompt,
    responseSchema: CRITIQUE_SCHEMA,
    maxTokens: 800,
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

const QUESTION_SYSTEM = `You are someone who just read a note and immediately spotted a gap, tension, or assumption worth challenging.
CRITICAL: Any BACKGROUND sections in the context are documents the user already knows. Do not ask about anything covered there — they wrote it. Only ask about things not addressed anywhere in the context.
Never ask the user to elaborate on or explain something they already stated — that is not a question, it is a prompt to repeat themselves.
Ask about implications, contradictions, risks, tradeoffs, or things that are genuinely unknown. Make them think, not just type more of what they already know.
Short. Direct. Conversational. No jargon. Think "Why not X?", "What's the catch?", "What breaks first?" not "How do you plan to..."
Often the best questions are just a few words: "Why not X?", "What happens when Y?", "Who decides?"
Do not ask about anything already answered or addressed in the node body.
Set yesNo to true only if the question can be fully resolved by Yes or No alone.
Return only the question. No preamble.
${NO_DISCLAIMER_BLOCK}`

export async function questionNode(contextPrompt: string): Promise<QuestionItem> {
  return callAI<QuestionItem>({
    systemInstruction: QUESTION_SYSTEM,
    userPrompt: contextPrompt,
    responseSchema: QUESTION_SCHEMA,
    maxTokens: 300,
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

const TONE_BLOCK = `TONE — critical: Match the voice and register of the existing content exactly. Casual stays casual; technical stays technical. Write like the person who wrote the original — same vocabulary, same energy.`

const EXPAND_SYSTEM = `You are helping develop ideas on an ideation board.
The BOARD SKELETON shows ALL ideas that already exist — do not duplicate or paraphrase any of them.
Generate however many new, concrete ideas naturally extend or build upon the TARGET NODE — no fixed count.
If the content strongly suggests one direction, return one. If it opens several distinct threads, return several.
Do NOT pad to reach a number. Each idea must earn its place.
Each idea must be distinct from everything in the skeleton. Avoid generic brainstorming platitudes.
Keep titles under 60 characters. Titles must be self-contained: a reader who sees only the title (not the parent body) must understand the idea — no pronouns ("this", "it"), no vague referents ("the approach", "the solution"), no implicit callbacks to the parent body. Bodies should be 1-2 sentences.
${TONE_BLOCK}
${NO_DISCLAIMER_BLOCK}`

const PROPOSE_SYSTEM = `You are helping find new ideas related to a concept on an ideation board.
The BOARD SKELETON shows ALL ideas that already exist — do not duplicate or paraphrase any of them.
Generate however many sibling ideas naturally emerge — related to the TARGET NODE's domain but approaching it from different angles.
No fixed count. If one strong angle exists, return one. If several distinct approaches arise, return several.
Do NOT pad to reach a number. Each idea must earn its place.
Each idea must be distinct from everything in the skeleton.
Keep titles under 60 characters. Titles must be self-contained: a reader who sees only the title (not the parent body) must understand the idea — no pronouns ("this", "it"), no vague referents ("the approach", "the solution"), no implicit callbacks to the parent body. Bodies should be 1-2 sentences.
${TONE_BLOCK}
${NO_DISCLAIMER_BLOCK}`

export async function expandNode(contextPrompt: string): Promise<IdeaItem[]> {
  return callAI<IdeaItem[]>({
    systemInstruction: EXPAND_SYSTEM,
    userPrompt: contextPrompt,
    responseSchema: IDEA_SCHEMA,
    maxTokens: 1000,
  })
}

export async function proposeIdeas(contextPrompt: string): Promise<IdeaItem[]> {
  return callAI<IdeaItem[]>({
    systemInstruction: PROPOSE_SYSTEM,
    userPrompt: contextPrompt,
    responseSchema: IDEA_SCHEMA,
    maxTokens: 1000,
  })
}

// ── Push Thinking (mixed starter set) ────────────────────────────────────────

export interface PushItem {
  type: 'idea' | 'question' | 'problem'
  title: string
  body: string
}

const PUSH_SCHEMA = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      type: { type: 'string', enum: ['idea', 'question', 'problem'] },
      title: { type: 'string' },
      body: { type: 'string' },
    },
    required: ['type', 'title', 'body'],
  },
}

const PUSH_SYSTEM = `You are kicking off an ideation session on a thinking canvas.
Generate 3-5 starter nodes that give someone immediate traction to explore the TARGET NODE from different angles.
Mix the types — include ideas, questions, and at least one problem. No two nodes should approach the same angle or contradict each other.
Think of these as distinct threads someone could pull on: each one opens a different door.
Types:
- "idea": a direction, variant, or approach worth exploring
- "question": a key uncertainty or thing worth knowing first
- "problem": a real obstacle, risk, or challenge to reckon with
Rules:
- Titles under 60 chars. Self-contained: no pronouns, no vague referents. A reader seeing only the title must understand it without context.
- Bodies 1-2 sentences. Plain language, no jargon.
- Do NOT duplicate anything already in the board skeleton.
- Do NOT pad — only include nodes that genuinely earn their place.
${TONE_BLOCK}
${NO_DISCLAIMER_BLOCK}`

export async function pushThinking(contextPrompt: string): Promise<PushItem[]> {
  return callAI<PushItem[]>({
    systemInstruction: PUSH_SYSTEM,
    userPrompt: contextPrompt,
    responseSchema: PUSH_SCHEMA,
    maxTokens: 1200,
  })
}

// ── Summary ───────────────────────────────────────────────────────────────────

const SUMMARY_SYSTEM = `You are a precise summarizer.
Write 2-4 short bullet points capturing the key points of this idea/description.
Each bullet starts with "• " on its own line. Keep each bullet under 10 words.
Be concrete — no filler, no restating the title.
${NO_DISCLAIMER_BLOCK}`

export async function generateSummary(title: string, body: string): Promise<string> {
  const result = await callAI<{ summary: string }>({
    systemInstruction: SUMMARY_SYSTEM,
    userPrompt: `Title: ${title}\n\nBody:\n${body}`,
    responseSchema: {
      type: 'object',
      properties: { summary: { type: 'string' } },
      required: ['summary'],
    },
    maxTokens: 200,
  })
  return result.summary
}

// ── Integrate Q&A into node body ──────────────────────────────────────────────

const INTEGRATE_SYSTEM = `You are updating a personal note on an ideation board.
Receive: a node (title + body), a question asked about it, and the answer given.
Task: rewrite the body incorporating the new knowledge.

${TONE_BLOCK}

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

TITLE: Only provide a new title if the answer fundamentally renames the concept (under 60 chars). Otherwise leave blank.
${NO_DISCLAIMER_BLOCK}`

export async function integrateQA(
  contextPrompt: string,
  question: string,
  answer: string,
): Promise<{ body: string; title?: string }> {
  return callAI<{ body: string; title?: string }>({
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
    maxTokens: 1500,
  })
}

export async function integrateAllQA(
  contextPrompt: string,
  pairs: Array<{ question: string; answer: string }>,
): Promise<{ body: string; title?: string }> {
  const pairsText = pairs
    .map((p, i) => `Q${i + 1}: ${p.question}\nA${i + 1}: ${p.answer}`)
    .join('\n\n')
  return callAI<{ body: string; title?: string }>({
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
    maxTokens: 1500,
  })
}

const INTEGRATE_IDEA_SYSTEM = `You are updating a personal note on an ideation board.
Receive: a node (title + body) and one specific idea being merged into it.
Task: rewrite the body to adopt the idea as the accepted direction. The idea represents the user's decision — treat it as the authoritative new input. If the existing body contradicts the idea, the idea wins: remove or rewrite the contradicting content so the body aligns with the idea. Do not keep both sides of a contradiction. Do not pull in, summarize, or reference other nodes visible in the board skeleton — they are context only, not input.

${TONE_BLOCK}

FORMAT — proper markdown:
- Bullet lists for facts, thoughts, constraints. Each bullet on its own line starting with "- ".
- NEVER put multiple bullets on one line separated by " - ".
- Use ## headings only when content naturally falls into distinct sections.
- Each bullet = 1–2 sentences max. Be terse.
- No filler openers. No top-level title.

CROSS-REFERENCES:
- You may link to IDEA nodes from the BOARD SKELETON using: [Node Title](node:NODE_ID)
  The NODE_ID is the full UUID in the first brackets of each skeleton entry.
- Only link ideas that are genuinely conceptually related — not just adjacent.
- Do NOT link to questions, answers, problems, or core nodes — ideas only.

TITLE: Only provide a new title if the idea fundamentally renames the concept (under 60 chars). Otherwise leave blank.
${NO_DISCLAIMER_BLOCK}`

export async function integrateIdea(
  contextPrompt: string,
  ideaTitle: string,
  ideaBody: string,
): Promise<{ body: string; title?: string }> {
  return callAI<{ body: string; title?: string }>({
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
    maxTokens: 1500,
  })
}

const ACKNOWLEDGE_PROBLEM_SYSTEM = `You are updating a personal note on an ideation board.
Receive: a node (title + body) and a problem/concern that has been raised about it and is now being acknowledged.
Task: briefly note this concern in the body — as a known limitation, caveat, or addressed issue. Add at most 1–2 short sentences.
Rules:
- Do not solve the problem or elaborate extensively — just acknowledge it exists or has been considered.
- Only integrate the provided problem. Do not pull in other nodes visible in the board skeleton.
- No filler openers ("Note that...", "It is worth...").
- No top-level title.

${TONE_BLOCK}

TITLE: Only provide a new title if the concern fundamentally reframes the concept (under 60 chars). Otherwise leave blank.
${NO_DISCLAIMER_BLOCK}`

export async function acknowledgeProblem(
  contextPrompt: string,
  problemTitle: string,
  problemBody: string,
): Promise<{ body: string; title?: string }> {
  return callAI<{ body: string; title?: string }>({
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
    maxTokens: 1500,
  })
}

const REJECT_IDEA_SYSTEM = `You are updating a personal note on an ideation board.
An idea that was spawned from it is being rejected.
If the idea's content was already integrated into the body, remove that integration first.
Then append one brief sentence noting the idea was considered and rejected.
Rules: one added sentence max. Start with "Considered " or "Explored ". Do not editorialize.

${TONE_BLOCK}
${NO_DISCLAIMER_BLOCK}`

export async function rejectIdea(
  contextPrompt: string,
  ideaTitle: string,
  ideaBody: string,
): Promise<{ body: string }> {
  return callAI<{ body: string }>({
    systemInstruction: REJECT_IDEA_SYSTEM,
    userPrompt: `${contextPrompt}\n\nREJECTED IDEA: ${ideaTitle}\nIDEA CONTENT: ${ideaBody}`,
    responseSchema: {
      type: 'object',
      properties: { body: { type: 'string' } },
      required: ['body'],
    },
    maxTokens: 800,
  })
}

const REJECTION_SYSTEM = `You are updating a personal note on an ideation board.
Receive: a node (title + body), a question that was asked, and an answer that was rejected.
The answer may have already been integrated into the body — if so, remove that integration first.
Task: rewrite the body removing any content that came from the rejected answer, then append one brief sentence noting it was considered and rejected.
Rules: preserve all content that did NOT come from the rejected answer. One added sentence max. Start with "Considered " or "Explored ". Do not editorialize.

${TONE_BLOCK}
${NO_DISCLAIMER_BLOCK}`

export async function integrateRejection(
  contextPrompt: string,
  question: string,
  rejectedAnswer: string,
): Promise<{ body: string }> {
  return callAI<{ body: string }>({
    systemInstruction: REJECTION_SYSTEM,
    userPrompt: `${contextPrompt}\n\nQUESTION ASKED: ${question}\nREJECTED ANSWER: ${rejectedAnswer}`,
    responseSchema: {
      type: 'object',
      properties: { body: { type: 'string' } },
      required: ['body'],
    },
    maxTokens: 1500,
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
description: ONE sentence max. State only the core clash. No preamble, no elaboration.
If the conflict is already self-evident from both node titles alone, set description to an empty string — do not restate the obvious.
In the description, refer to other nodes by their title (never by their ID).
Return an empty array if no real contradictions exist.`

export interface ConflictItem {
  nodeId: string
  description: string
}

export async function detectConflicts(
  updatedTitle: string,
  _updatedBody: string,
  otherNodes: Array<{ id: string; type: string; title: string; body: string; summary: string }>,
): Promise<ConflictItem[]> {
  if (otherNodes.length === 0) return []
  const others = otherNodes
    .map(n => `[${n.id}] [${n.type}] "${n.title}"`)
    .join('\n')
  const items = await callAI<ConflictItem[]>({
    systemInstruction: CONFLICT_SYSTEM,
    userPrompt: `UPDATED NODE:\nTitle: ${updatedTitle}\n\nOTHER NODES:\n${others}`,
    responseSchema: CONFLICT_SCHEMA,
    maxTokens: 600,
  })
  return items.map(item => ({
    ...item,
    description: otherNodes.reduce(
      (desc, n) => desc.replace(new RegExp(n.id.slice(0, 8), 'g'), `"${n.title}"`),
      item.description,
    ),
  }))
}

// ── Conflict hint ─────────────────────────────────────────────────────────────

const HINT_SYSTEM = `You are a conflict advisor on an ideation board.
In ONE short sentence, give a concrete action to resolve the contradiction.
Start with an active verb. Name the specific claims. No preamble. No fluff.`

export async function hintConflictResolution(
  titleA: string,
  titleB: string,
  description: string,
): Promise<string> {
  const result = await callAI<{ hint: string }>({
    systemInstruction: HINT_SYSTEM,
    userPrompt: `Node A: "${titleA}"\nNode B: "${titleB}"\nContradiction: ${description}`,
    responseSchema: {
      type: 'object',
      properties: { hint: { type: 'string' } },
      required: ['hint'],
    },
    maxTokens: 100,
  })
  return result.hint
}

// ── Conflict resolution ───────────────────────────────────────────────────────

const RESOLVE_CONFLICT_SYSTEM = `You are helping resolve a content conflict on an ideation board.
The user is merging an idea that directly contradicts part of the node's current content.
Generate exactly 2 distinct resolution paths. They MUST be genuinely different — not two versions of the same stance.

Option A — New direction wins: Keep ALL existing body content that is not directly about the contradiction. Only remove or rewrite the specific sentence(s) or bullet(s) that directly conflict with the idea. Add the idea's direction in their place.
Option B — Existing direction wins: Keep the existing body exactly as-is. Add at most 1 short bullet acknowledging the incoming idea was considered and why it was not adopted.

These options must be clearly opposites. Do NOT let both options lean the same way.

CRITICAL — Do NOT drop content unrelated to the conflict. The body you produce must contain everything from the existing body EXCEPT the contradicting part(s). This is a surgical edit, not a rewrite.

Rules:
- Match the voice and register of the existing content exactly.
- Bullet lists for facts/constraints. Each bullet on its own line starting with "- ". NEVER put multiple bullets on one line.
- No filler openers. No top-level title.
- summary: One direct sentence (max 12 words) that clearly names which direction this takes. Do NOT start with "This path" or "This option" — state the decision directly.
- body: The updated body. Must preserve all existing non-conflicting content — only the contradicting part changes.`

export interface ConflictOption {
  summary: string
  body: string
}

export async function resolveConflict(
  contextPrompt: string,
  ideaTitle: string,
  ideaBody: string,
): Promise<{ options: [ConflictOption, ConflictOption] }> {
  return callAI({
    systemInstruction: RESOLVE_CONFLICT_SYSTEM,
    userPrompt: `${contextPrompt}\n\nIDEA BEING MERGED: ${ideaTitle}\nIDEA CONTENT: ${ideaBody}`,
    responseSchema: {
      type: 'object',
      properties: {
        options: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              summary: { type: 'string', description: 'One sentence (max 12 words) naming the decision direction' },
              body:    { type: 'string' },
            },
            required: ['summary', 'body'],
          },
        },
      },
      required: ['options'],
    },
    maxTokens: 2000,
  })
}

// ── Board propagation ─────────────────────────────────────────────────────────

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
Given a board skeleton, identify UP TO 3 other nodes (not directly connected to the updated node) that would meaningfully benefit from this same insight.
Only return nodes where the insight genuinely changes or extends their content — not just tangentially related.
Return an empty array if no other nodes are affected.
Only return nodeId values for idea, core, or problem nodes — never questions, answers, or notes.
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
  const result = await callAI<Array<{ nodeId: string }>>({
    systemInstruction: PROPAGATE_SYSTEM,
    userPrompt: `Q: ${question}\nA: ${answer}\n\nUPDATED NODE ID: ${updatedNodeId}\n\nBOARD:\n${skeleton}`,
    responseSchema: PROPAGATE_SCHEMA,
    maxTokens: 300,
  })
  return result.map(r => r.nodeId).filter(id => id !== updatedNodeId)
}

// ── Argue (critique variant) ──────────────────────────────────────────────────

const ARGUE_SYSTEM = `You are a sharp reader who just heard this answer and immediately pushed back.
Identify the most natural, direct problems — what a smart skeptic would say out loud right after reading.
Short sentences. Plain language. No formal analysis.
Think: "But that doesn't explain...", "That only works if...", "You're ignoring...", "This breaks when..."
Score 0.0–1.0: 0.3 = minor concern, 0.6 = significant problem, 0.9 = near-fatal flaw. Return empty array if no real problems exist.
Each problem: 1–2 sentences max.
${NO_DISCLAIMER_BLOCK}`

export async function argueNode(contextPrompt: string): Promise<CritiqueItem[]> {
  const items = await callAI<CritiqueItem[]>({
    systemInstruction: ARGUE_SYSTEM,
    userPrompt: contextPrompt,
    responseSchema: CRITIQUE_SCHEMA,
    maxTokens: 800,
  })
  return items.filter(i => i.severity >= SEVERITY_THRESHOLD)
}

// ── AI-generated answer / solution (with search on Gemini) ────────────────────

const ANSWER_SYSTEM = `You are a domain expert being asked a direct question by a colleague. Answer like one.
CRITICAL: Any BACKGROUND sections in the context are documents the user already knows — they imported them. Never quote, paraphrase, or repeat that content. Use it only to understand constraints. Your answer must add something the user cannot already read in the background.
Give the actual answer — specific, confident, concrete. Use real numbers, names, and facts when relevant.
No hedging. No "it depends". No "may", "might", "could", "typically". If something is true, state it.
One sentence. No preamble, no restating the question, no elaboration, no options.
Commit to the single best answer. No lists, no "such as X, Y, Z" chains.
Never use first person. Never say "I", "I need to", "I'll", "I found", "I think". Start directly with the answer.
No preamble. No sign-off. No restating the question.
${NO_DISCLAIMER_BLOCK}
${UNITS_BLOCK}
Plain prose only — no bullets, no lists, no bold, no markdown.
Never give options or choices — commit to one answer.
If existing answers are already on the board (visible in context), provide a different angle — do not repeat what's there.
Do not include URLs, links, or citations.`

export async function answerQuestion(contextPrompt: string): Promise<{ answer: string }> {
  const result = await callAISearch({ systemInstruction: ANSWER_SYSTEM, userPrompt: contextPrompt, maxTokens: 200 })
  return { answer: result.text }
}

const SOLUTION_SYSTEM = `You are a direct, practical colleague in a brainstorming session.
One sentence. Specific to this exact problem — not generic advice that could apply to anything.
Name the concrete thing: a mechanic, a rule, a constraint, a specific decision. Not "consider X" or "focus on Y" — say what to actually do.
No preamble, no restating the problem, no elaboration, no options.
Plain prose only. No markdown.
${NO_DISCLAIMER_BLOCK}
If existing solutions are already connected to this problem, provide a different approach — do not repeat what's already there.`

export async function generateSolution(contextPrompt: string): Promise<{ answer: string }> {
  const result = await callAISearch({ systemInstruction: SOLUTION_SYSTEM, userPrompt: contextPrompt, maxTokens: 120 })
  return { answer: result.text }
}

// ── Correct an answer ─────────────────────────────────────────────────────────

const CORRECT_ANSWER_SYSTEM = `You are a sharp colleague revising a quick answer after a correction.
Use the correction as the new direction, but stay fully consistent with the constraints and context visible in the board — if the context rules something out, the revised answer must respect that.
One or two short sentences. Casual and direct. No preamble, no meta-commentary, no "you're right", no summaries.
${NO_DISCLAIMER_BLOCK}`

export async function correctAnswer(
  contextPrompt: string,
  originalAnswer: string,
  correction: string,
): Promise<{ answer: string }> {
  return callAI<{ answer: string }>({
    systemInstruction: CORRECT_ANSWER_SYSTEM,
    userPrompt: `${contextPrompt}\n\nORIGINAL ANSWER: ${originalAnswer}\n\nUSER CORRECTION: ${correction}`,
    responseSchema: {
      type: 'object',
      properties: { answer: { type: 'string' } },
      required: ['answer'],
    },
    maxTokens: 300,
  })
}

// ── Brief generation ──────────────────────────────────────────────────────────

const BRIEF_SYSTEM = `You are arranging, not writing. Use the actual words from the nodes as much as possible — quote them, combine them, trim them. Do not rewrite in your own voice.
Your only job is to order the ideas so they flow and cut what's redundant. Add a word or two of connective tissue only when something would be incomprehensible without it.
The output should read like the person's own words put in order, not a paraphrase.
No intro sentence, no outro, no meta-commentary. Just the ideas.
No top-level title — return that separately.
Format each idea as a markdown bullet point starting with "- ". One idea per bullet. Keep each bullet concise — one sentence max.
Nodes tagged [ACCEPTED] were explicitly approved by the user — list them first and bold them with **text**.`

export async function generateBrief(graph: ThonkGraph): Promise<{ title: string; markdown: string }> {
  const sourceNodes = graph.nodes.filter(n => n.type === 'core' || n.type === 'idea' || n.thumb === 'up')

  if (!hasActiveKey() || !sourceNodes.length) {
    const fallback = sourceNodes
      .map(n => `## ${n.title}\n\n${n.body || '*No content yet.*'}`)
      .join('\n\n---\n\n')
    return { title: sourceNodes[0]?.title || 'Untitled', markdown: fallback }
  }

  const nodeLines = sourceNodes
    .map(n => `[${n.type}]${n.thumb === 'up' ? '[ACCEPTED]' : ''} "${n.title}"\n${n.body || ''}`)
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

  const result = await callAI<{ title: string; markdown: string }>({
    systemInstruction: BRIEF_SYSTEM,
    userPrompt: `NODES:\n${nodeLines}${edgeLines ? `\n\nCONNECTIONS:\n${edgeLines}` : ''}`,
    responseSchema: {
      type: 'object',
      properties: {
        title:    { type: 'string' },
        markdown: { type: 'string' },
      },
      required: ['title', 'markdown'],
    },
  })
  result.markdown = result.markdown.replace(/\s*—\s*/g, ' - ')
  return result
}

// ── Analysis generation ───────────────────────────────────────────────────────

const ANALYSIS_SYSTEM = `Read these thinking notes and write a short, sharp review of them — like a critic summarizing someone's pitch deck after the room cleared out.

Write 3–4 short paragraphs. No headers. No bullets. Plain sentences. Third person only — never "you" or "your".

Match the tone of the content — if it's casual, stay casual. If it's technical, stay grounded.

First paragraph: what's been figured out or landed on. Use the actual words from the notes where possible.
Second paragraph: what's still open, fuzzy, or contradicting itself. Don't soften it.
Third paragraph: the core thing that makes this hard. The real tradeoff. One sentence if possible.
Optional fourth: if there's an obvious next move, name it bluntly.

No "you", no "your". Write about the ideas, not the person.
No business words. No "leveraging", "synergy", "ecosystem", "strategic". Write like you talk.
Short sentences. If a paragraph runs past 3 sentences, cut it.
Be specific to what's actually in the notes — no generic advice.
${NO_DISCLAIMER_BLOCK}`

export async function generateReport(graph: ThonkGraph): Promise<{ title: string; markdown: string }> {
  const nodes = graph.nodes.filter(n => n.type !== 'source' && n.type !== 'note')

  if (!hasActiveKey() || !nodes.length) {
    return { title: 'Analysis', markdown: '*Connect AI to generate an analysis.*' }
  }

  const nodeLines = nodes
    .map(n => {
      const tags = [n.type, n.resolved ? 'resolved' : null, n.thumb === 'up' ? 'accepted' : n.thumb === 'down' ? 'dropped' : null].filter(Boolean).join(', ')
      return `[${tags}] "${n.title}"${n.body ? `\n${n.body}` : ''}`
    })
    .join('\n\n')

  const nodeIds = new Set(nodes.map(n => n.id))
  const edgeLines = graph.edges
    .filter(e => nodeIds.has(e.source) && nodeIds.has(e.target))
    .map(e => {
      const src = nodes.find(n => n.id === e.source)?.title ?? e.source
      const tgt = nodes.find(n => n.id === e.target)?.title ?? e.target
      return `"${src}" --${e.relation}--> "${tgt}"`
    })
    .join('\n')

  const result = await callAI<{ title: string; markdown: string }>({
    systemInstruction: ANALYSIS_SYSTEM,
    userPrompt: `NODES:\n${nodeLines}${edgeLines ? `\n\nCONNECTIONS:\n${edgeLines}` : ''}`,
    responseSchema: {
      type: 'object',
      properties: {
        title:    { type: 'string' },
        markdown: { type: 'string' },
      },
      required: ['title', 'markdown'],
    },
  })
  result.markdown = result.markdown.replace(/\s*—\s*/g, ' - ')
  return result
}

// ── Gaps analysis ─────────────────────────────────────────────────────────────

const GAPS_SYSTEM = `You are a critical thinker reviewing a thinking canvas. Your job is NOT to summarize what's there — find what's MISSING or WEAK.

Identify up to 3 items in each category. Be specific — quote actual node titles from the input. If you can't find something genuine, return fewer items or an empty array.

assumptions: things taken for granted that could break the reasoning if wrong. Name the assumption itself, not the node it's embedded in.
missing: important counterarguments, alternatives, or perspectives the thinking hasn't engaged with.
orphans: thoughts that appear disconnected from the main thread.

One sentence per item. No generic advice. No business words.
${NO_DISCLAIMER_BLOCK}`

export async function generateGaps(graph: ThonkGraph): Promise<{ title: string; markdown: string }> {
  const nodes = graph.nodes.filter(n => n.type !== 'source' && n.type !== 'note')

  if (!hasActiveKey() || !nodes.length) {
    return { title: 'Gaps', markdown: '*Connect AI to find gaps in your thinking.*' }
  }

  const nodeLines = nodes
    .map(n => {
      const tags = [n.type, n.resolved ? 'resolved' : null, n.thumb === 'up' ? 'accepted' : n.thumb === 'down' ? 'dropped' : null].filter(Boolean).join(', ')
      return `[${tags}] "${n.title}"${n.body ? `\n${n.body}` : ''}`
    })
    .join('\n\n')

  const nodeIds = new Set(nodes.map(n => n.id))
  const edgeLines = graph.edges
    .filter(e => nodeIds.has(e.source) && nodeIds.has(e.target))
    .map(e => {
      const src = nodes.find(n => n.id === e.source)?.title ?? e.source
      const tgt = nodes.find(n => n.id === e.target)?.title ?? e.target
      return `"${src}" --${e.relation}--> "${tgt}"`
    })
    .join('\n')

  const result = await callAI<{ title: string; assumptions: string[]; missing: string[]; orphans: string[] }>({
    systemInstruction: GAPS_SYSTEM,
    userPrompt: `NODES:\n${nodeLines}${edgeLines ? `\n\nCONNECTIONS:\n${edgeLines}` : ''}`,
    responseSchema: {
      type: 'object',
      properties: {
        title:       { type: 'string' },
        assumptions: { type: 'array', items: { type: 'string' } },
        missing:     { type: 'array', items: { type: 'string' } },
        orphans:     { type: 'array', items: { type: 'string' } },
      },
      required: ['title', 'assumptions', 'missing', 'orphans'],
    },
  })

  const sections: string[] = []
  if (result.assumptions.length) {
    sections.push('## Unquestioned Assumptions\n' + result.assumptions.map(a => `- ${a}`).join('\n'))
  }
  if (result.missing.length) {
    sections.push('## Missing Angles\n' + result.missing.map(m => `- ${m}`).join('\n'))
  }
  if (result.orphans.length) {
    sections.push('## Disconnected Ideas\n' + result.orphans.map(o => `- ${o}`).join('\n'))
  }

  return { title: result.title || 'Gaps', markdown: sections.join('\n\n') }
}
