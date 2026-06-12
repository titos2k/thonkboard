export interface AIRequest {
  systemInstruction: string
  userPrompt: string
  responseSchema: object
}

export type Provider = 'gemini' | 'openai' | 'anthropic' | 'deepseek' | 'ollama'
