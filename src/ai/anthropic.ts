import type { AIRequest } from './types'

export const MODEL_LITE  = 'claude-haiku-4-5-20251001'
export const MODEL_SMART = 'claude-sonnet-4-6'
const BASE = 'https://api.anthropic.com/v1'

function isHighIQ(): boolean {
  return localStorage.getItem('thonk.highiq') === '1'
}

function getModel(): string {
  return isHighIQ() ? MODEL_SMART : MODEL_LITE
}

function getKey(): string {
  return localStorage.getItem('thonk.apikey.anthropic') ?? ''
}

function assertKey(): void {
  if (!getKey()) throw new Error('No API key set. Add your key in the top bar.')
}

function headers(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'x-api-key': getKey(),
    'anthropic-version': '2023-06-01',
    'anthropic-dangerous-direct-browser-access': 'true',
    'anthropic-beta': 'prompt-caching-2024-07-31',
  }
}

export async function callAnthropic<T>(req: AIRequest): Promise<T> {
  assertKey()

  const schema = req.responseSchema as Record<string, unknown>
  const wrapped = schema.type === 'array'
  const inputSchema = wrapped
    ? { type: 'object', properties: { items: schema }, required: ['items'] }
    : schema

  const res = await fetch(`${BASE}/messages`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({
      model: getModel(),
      max_tokens: req.maxTokens ?? 4096,
      system: [{ type: 'text', text: req.systemInstruction, cache_control: { type: 'ephemeral' } }],
      tools: [{
        name: 'output',
        description: 'Return the result in the required format.',
        input_schema: inputSchema,
      }],
      tool_choice: { type: 'tool', name: 'output' },
      messages: [{ role: 'user', content: req.userPrompt }],
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Anthropic error ${res.status}: ${err}`)
  }

  const data = await res.json()
  const block = data.content.find((b: { type: string }) => b.type === 'tool_use')
  if (!block) throw new Error('Anthropic returned no structured output')
  return (wrapped ? (block.input as { items: T }).items : block.input) as T
}

export async function callAnthropicSearch(req: Omit<AIRequest, 'responseSchema'>): Promise<string> {
  assertKey()

  const res = await fetch(`${BASE}/messages`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({
      model: getModel(),
      max_tokens: req.maxTokens ?? 600,
      system: [{ type: 'text', text: req.systemInstruction, cache_control: { type: 'ephemeral' } }],
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }],
      messages: [{ role: 'user', content: req.userPrompt }],
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Anthropic error ${res.status}: ${err}`)
  }

  const data = await res.json()
  const textBlocks: string[] = data.content
    .filter((b: { type: string }) => b.type === 'text')
    .map((b: { text: string }) => b.text)
  // Use only the last text block — earlier blocks are pre-search narration ("I need to...")
  return textBlocks[textBlocks.length - 1] ?? ''
}

export async function callAnthropicText(req: Omit<AIRequest, 'responseSchema'>): Promise<string> {
  assertKey()

  const res = await fetch(`${BASE}/messages`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({
      model: getModel(),
      max_tokens: 2048,
      system: [{ type: 'text', text: req.systemInstruction, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: req.userPrompt }],
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Anthropic error ${res.status}: ${err}`)
  }

  const data = await res.json()
  const block = data.content.find((b: { type: string }) => b.type === 'text')
  return block?.text ?? ''
}
