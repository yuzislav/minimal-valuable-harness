import { Message, Provider } from '../types';

export class LocalProvider implements Provider {
  private apiUrl: string;
  private model: string;

  constructor(
    apiUrl: string = process.env.LOCAL_API_URL || 'http://localhost:11434/v1/chat/completions',
    model: string = process.env.LOCAL_MODEL_NAME || 'llama3'
  ) {
    this.apiUrl = apiUrl;
    this.model = model;
  }

  async generate(messages: Message[], systemPrompt?: string): Promise<string> {
    const apiMessages: any[] = [];
    
    if (systemPrompt) {
      apiMessages.push({ role: 'system', content: systemPrompt });
    }

    for (const msg of messages) {
      apiMessages.push({
        role: msg.role,
        content: msg.content
      });
    }

    const payload = {
      model: this.model,
      messages: apiMessages,
      // Provide a stop sequence if needed, but OpenAI compatible APIs handle standard stops.
    };

    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };

    if (process.env.LOCAL_API_KEY) {
      headers['Authorization'] = `Bearer ${process.env.LOCAL_API_KEY}`;
    }

    const response = await fetch(this.apiUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`LocalProvider API Error (${response.status}): ${errorText}`);
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content || '';
  }
}
