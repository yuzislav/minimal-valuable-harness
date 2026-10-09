import { GoogleGenAI } from '@google/genai';
import { Message, Provider } from '../types';
import { withRetry } from '../utils/retry';

export class GeminiProvider implements Provider {
  private ai: GoogleGenAI;
  private model: string;

  constructor(apiKey: string, model: string = process.env.GEMINI_MODEL || 'gemini-3.6-flash') {
    this.ai = new GoogleGenAI({ apiKey });
    this.model = model;
  }

  async generate(messages: Message[], systemPrompt?: string): Promise<string> {
    const contents = messages
      .filter(msg => msg.role !== 'system')
      .map(msg => ({
        role: msg.role === 'assistant' ? 'model' : msg.role,
        parts: [{ text: msg.content }]
      }));

    return withRetry(async () => {
      const response = await this.ai.models.generateContent({
        model: this.model,
        contents,
        config: {
          systemInstruction: systemPrompt ? { parts: [{ text: systemPrompt }] } : undefined,
        }
      });

      const candidate = response.candidates?.[0];
      if (candidate && candidate.finishReason !== 'STOP') {
        throw new Error(`Model did not finish successfully. Finish reason: ${candidate.finishReason}`);
      }

      return response.text || '';
    });
  }
}
