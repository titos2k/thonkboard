import type { AIRequest } from './types'

export type OAICompatProvider = 'openai' | 'deepseek' | 'ollama'

const PROVIDER_BASE: Record<OAICompatProvider, string> = {
  openai:   'https://api.openai.com/v1',
  deepseek: 'https://api.deepseek.com/v1',
  ollama:   'http://localhost:11434/v1',
}

export const PROVIDER_MODEL_LITE: Record<OAICompatProvider, string> = {
  openai:   'gpt-4.1-mini',
  deepseek: 'deepseek-chat',
  ollama:   'gemma4',
}

export const PROVIDER_MODEL_SMART: Record<OAICompatProvider, string> = {
  openai:   'gpt-4.1',
  deepseek: 'deepseek-reasoner',
  ollama:   'gemma4',
}

function isHighIQ(): boolean {
  return localStorage.getItem('thonk.highiq') === '1'
}

export function getOllamaBaseUrl(): string {
  return localStorage.getItem('thonk.ollama.baseurl') ?? 'http://localhost:11434/v1'
}

export function getOllamaModel(): string {
  return localStorage.getItem('thonk.ollama.model') ?? 'gemma4'
}

export function setOllamaConfig(baseUrl: string, model: string): void {
  localStorage.setItem('thonk.ollama.baseurl', baseUrl)
  localStorage.setItem('thonk.ollama.model', model)
}

function isOllamaLocal(): boolean {
  const u = getOllamaBaseUrl()
  return u.startsWith('http://localhost') || u.startsWith('http://127.')
}

function resolveUrlAndModel(provider: OAICompatProvider): { baseUrl: string; model: string } {
  if (provider === 'ollama') return { baseUrl: getOllamaBaseUrl(), model: getOllamaModel() }
  const models = isHighIQ() ? PROVIDER_MODEL_SMART : PROVIDER_MODEL_LITE
  return { baseUrl: PROVIDER_BASE[provider], model: models[provider] }
}

function buildHeaders(provider: OAICompatProvider): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const key = localStorage.getItem(`thonk.apikey.${provider}`) ?? ''
  if (key) headers['Authorization'] = `Bearer ${key}`
  return headers
}

function assertKey(provider: OAICompatProvider): void {
  if (provider === 'ollama' && isOllamaLocal()) return
  if (!(localStorage.getItem(`thonk.apikey.${provider}`) ?? '')) {
    throw new Error('No API key set. Add your key in the top bar.')
  }
}

export async function callOpenAICompat<T>(provider: OAICompatProvider, req: AIRequest): Promise<T> {
  assertKey(provider)
  const { baseUrl, model } = resolveUrlAndModel(provider)

  // OpenAI supports json_schema; DeepSeek/Ollama only support json_object and require
  // the word "json" to appear in the prompt — append the schema as a hint.
  const useJsonSchema = provider === 'openai'

  // OpenAI requires the root schema to be type:object, and json_object models tend to
  // wrap array responses anyway — envelope all array schemas so behaviour is consistent.
  const isArraySchema = (req.responseSchema as { type?: string }).type === 'array'
  const envelopeSchema = isArraySchema
    ? { type: 'object', properties: { items: req.responseSchema }, required: ['items'] }
    : req.responseSchema

  const systemInstruction = useJsonSchema
    ? req.systemInstruction
    : `${req.systemInstruction}\n\nRespond only with valid JSON matching this schema:\n${JSON.stringify(envelopeSchema, null, 2)}`
  const responseFormat = useJsonSchema
    ? { type: 'json_schema', json_schema: { name: 'output', strict: false, schema: envelopeSchema } }
    : { type: 'json_object' }

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: buildHeaders(provider),
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemInstruction },
        { role: 'user',   content: req.userPrompt },
      ],
      response_format: responseFormat,
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`${provider} error ${res.status}: ${err}`)
  }

  const data = await res.json()
  const parsed = JSON.parse(data.choices[0].message.content)
  return (isArraySchema ? parsed.items : parsed) as T
}

export async function callOpenAISearch(req: Omit<AIRequest, 'responseSchema'>): Promise<string> {
  assertKey('openai')
  const { model } = resolveUrlAndModel('openai')

  const res = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: buildHeaders('openai'),
    body: JSON.stringify({
      model,
      input: `${req.systemInstruction}\n\n${req.userPrompt}`,
      tools: [{ type: 'web_search' }],
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`openai error ${res.status}: ${err}`)
  }

  const data = await res.json()
  const message = (data.output as Array<{ type: string; content?: unknown[] }>)
    ?.find(o => o.type === 'message')
  const textContent = (message?.content as Array<{ type: string; text?: string }>)
    ?.find(c => c.type === 'output_text')
  return textContent?.text ?? ''
}

export async function callOpenAICompatText(
  provider: OAICompatProvider,
  req: Omit<AIRequest, 'responseSchema'>,
): Promise<string> {
  assertKey(provider)
  const { baseUrl, model } = resolveUrlAndModel(provider)

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: buildHeaders(provider),
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: req.systemInstruction },
        { role: 'user',   content: req.userPrompt },
      ],
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`${provider} error ${res.status}: ${err}`)
  }

  const data = await res.json()
  return data.choices[0].message.content as string
}
