import { Tool } from '../types';

export const weatherTool: Tool = {
  name: 'weather',
  description: 'Check the weather for a specific city.',
  parameters: {
    type: 'object',
    properties: {
      cityName: {
        type: 'string',
        description: 'The name of the city to check the weather for (e.g. Paris, London).'
      },
      forecastDays: {
        type: 'number',
        description: 'Number of days for the forecast (e.g. 0 for current weather only, 1, 2, or 3).'
      }
    },
    required: ['cityName']
  },
  async execute(args: Record<string, any>): Promise<any> {
    const { cityName, forecastDays } = args;
    if (!cityName) {
      throw new Error("Missing 'cityName' argument");
    }

    try {
      // Append &T to remove ANSI escape sequences for clean text output
      const daysParam = forecastDays !== undefined ? forecastDays : '';
      const url = `https://wttr.in/${encodeURIComponent(cityName)}?${daysParam}&T`;
      
      const response = await fetch(url);
      
      if (!response.ok) {
         throw new Error(`Error fetching weather: ${response.statusText}`);
      }
      
      const text = await response.text();
      return text;
    } catch (e: any) {
      throw new Error(`Weather check failed: ${e.message}`);
    }
  }
};
