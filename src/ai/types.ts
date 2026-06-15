export interface AIRequest {
  systemInstruction: string
  userPrompt: string
  responseSchema: object
  maxTokens?: number
}

export type Provider = 'gemini' | 'openai' | 'anthropic' | 'deepseek' | 'ollama'
