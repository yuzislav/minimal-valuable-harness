import { Message, Provider } from '../types';

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
