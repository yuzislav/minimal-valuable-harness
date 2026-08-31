import { jsonrepair } from 'jsonrepair';

const brokenJSON = `[
  {
    "name": "weather",
    "arguments": {
      "cityName": "Kyiv",
      "forecastDays": 0
    }
  },
  {
    "name": "read_skill",
   "arguments": {
      "skill_name": "morning_routine"
  }
]`;

try {
  const repaired = jsonrepair(brokenJSON);
  console.log("Repaired successfully:\n" + repaired);
} catch (e) {
  console.error("Failed to repair:", e);
}
