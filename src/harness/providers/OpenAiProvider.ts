import { Message, Provider } from '../types';
import { withRetry } from '../utils/retry';

export class OpenAiProvider implements Provider {
  private apiKey: string;
  private model: string;
  private baseUrl: string;

  constructor(
    apiKey: string = process.env.OPENAI_API_KEY || '',
    model: string = process.env.OPENAI_MODEL || 'gpt-4o',
    baseUrl: string = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1'
  ) {
    this.apiKey = apiKey;
    this.model = model;
    this.baseUrl = baseUrl.replace(/\/$/, ''); // Remove trailing slash if present
  }

  async generate(messages: Message[], systemPrompt?: string): Promise<string> {
    const formattedMessages = messages.map(msg => ({
      role: msg.role,
      content: msg.content
    }));

    if (systemPrompt) {
      formattedMessages.unshift({ role: 'system', content: systemPrompt });
    }

    return withRetry(async () => {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`
        },
        body: JSON.stringify({
          model: this.model,
          messages: formattedMessages
        })
      });

      if (!response.ok) {
        const error: any = new Error(`OpenAI API Error: ${response.status} ${response.statusText}`);
        error.status = response.status;
        throw error;
      }

      const data = await response.json();
      
      const choice = data.choices?.[0];
      if (choice && choice.finish_reason !== 'stop' && choice.finish_reason !== 'tool_calls') {
        throw new Error(`Model did not finish successfully. Finish reason: ${choice.finish_reason}`);
      }

      return choice?.message?.content || '';
    });
  }
}
