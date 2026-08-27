import { GoogleGenAI } from '@google/genai';
import { Message, Provider } from './types';

export class GeminiProvider implements Provider {
  private ai: GoogleGenAI;
  private model: string;

  constructor(apiKey: string, model: string = process.env.GEMINI_MODEL || 'gemini-3.6-flash') {
    this.ai = new GoogleGenAI({ apiKey });
    this.model = model;
  }

  async generate(messages: Message[], systemPrompt?: string): Promise<string> {
    // Map our minimal Message format to the format required by the Gemini SDK
    const contents = messages
      .filter(msg => msg.role !== 'system') // System goes into config
      .map(msg => ({
        role: msg.role === 'assistant' ? 'model' : msg.role,
        parts: [{ text: msg.content }]
      }));

    const response = await this.ai.models.generateContent({
      model: this.model,
      contents,
      config: {
        systemInstruction: systemPrompt ? { parts: [{ text: systemPrompt }] } : undefined,
      }
    });

    return response.text || '';
  }
}
