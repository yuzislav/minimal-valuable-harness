# Minimal Valuable LLM Harness - Specification

## Overview
A minimal, clean, and educational TypeScript harness for running an LLM agent loop. It is designed to be encapsulated in a class for easy reuse in downstream applications (e.g., a Telegram bot).

## Core Features

1. **Agent Loop & Tool Calling**:
   - Injects a system prompt and available tools list into the LLM context.
   - Parses LLM output to detect and execute tool calls.
   - Supports parallel tool calling (executing multiple tools simultaneously if requested by the LLM).
   - Tool calling error feedback loop: errors from tool execution are fed back to the LLM for self-correction.
   - Implements a maximum iteration limit (configurable via environment variables) to prevent infinite loops.

2. **Context Management**:
   - Maintains conversation history.
   - Employs a rolling window approach: when context size reaches a specified threshold, older messages are pruned to prevent context window overflow.

3. **Protected Execution Environment**:
   - Supports tool execution (e.g., an `exec` tool) in a protected/sandboxed environment.

4. **Skills Support**:
   - Ability to load, parse, and support skills documented in Markdown (`.md`) files.

5. **Architecture & Code Quality**:
   - Encapsulated within a main `Agent` class.
   - Strict adherence to writing the minimal amount of code required to satisfy requirements.
   - Clean, human-readable structure aimed at educational purposes.
   - Includes meaningful, descriptive comments explaining the "why" and "how".
   - Implemented in TypeScript.
