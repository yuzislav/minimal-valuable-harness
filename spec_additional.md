# Additional Requirements (Post-Initial Spec)

This document summarizes the features, tools, and fixes that were implemented on top of the initial `spec.md`.

## 1. Environment & Configuration
- **Environment Variables:** 
  - Added `.env.example` to document required keys.
  - Extracted the model name to `GEMINI_MODEL` so it can be overridden (e.g., `gemini-3.6-flash`, `gemini-3.5-flash-lite`).
  - Added a `DEBUG` toggle to enable/disable detailed logging.
- **Execution Engine:** Replaced `ts-node` with `tsx` to ensure compatibility with modern Node/TypeScript versions and added an `npm start` script.

## 2. New Tools
- **`curl` Tool:** Allows the agent to make HTTP requests (GET, POST, etc.) and returns the status, headers, and response body using the native `fetch` API.
- **`weather` Tool:** Allows the agent to fetch the weather for a specific city by querying `https://wttr.in/{city_name}?{number_days_forecast}&T` (stripped of ANSI sequences for clean LLM ingestion).

## 3. New Skills
- **Morning Routine (`morning_routine.md`):** A step-by-step orchestration skill that instructs the agent to:
  1. Check the weather in Paris using the `weather` tool.
  2. Tell a joke by reading `joke_skill` via the `read_skill` tool.
  3. Combine both into a cheerful morning greeting.

## 4. Debugging & Observability
- **Verbose Loop Logging:** When `DEBUG=true` is set in the environment, the harness prints detailed execution information for every iteration:
  - Iteration count.
  - The raw request array (history length and full content) sent to the LLM.
  - The raw response text received from the LLM.
  - Details of any tool calls parsed from the response.
- **Color Formatting:** All debug outputs are printed using ANSI dim gray (`\x1b[90m`) to visually separate them from the main agent and user outputs in the terminal.
