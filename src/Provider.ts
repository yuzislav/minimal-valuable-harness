import { GoogleGenAI } from '@google/genai';
import { Message, Provider } from './types';

async function withRetry<T>(
  operation: () => Promise<T>,
  maxRetries: number = 3
): Promise<T> {
  let retries = 0;
  while (true) {
    try {
      return await operation();
    } catch (error: any) {
      const retriableCodes = [408, 429, 500, 502, 503, 504];
      if (retriableCodes.includes(error.status) && retries < maxRetries) {
        retries++;
        
        let waitTime = 10000 * Math.pow(2, retries - 1); 
        
        const retryMatch = error.message?.match(/Please retry in (\d+(\.\d+)?)s/);
        if (retryMatch) {
          waitTime = (parseFloat(retryMatch[1]) + 1) * 1000;
        }
        
        let secondsLeft = Math.round(waitTime / 1000);
        while (secondsLeft > 0) {
          process.stdout.write(`\r\x1b[33m[WARN] API Error (${error.status}). Retrying in ${secondsLeft}s... (Attempt ${retries}/${maxRetries})\x1b[0m\x1b[K`);
          await new Promise(resolve => setTimeout(resolve, 1000));
          secondsLeft--;
        }
        console.log('');
      } else {
        throw error;
      }
    }
  }
}

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
