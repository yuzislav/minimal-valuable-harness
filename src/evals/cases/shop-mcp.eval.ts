/**
 * Shop MCP Eval Suite
 *
 * Tests the agent harness looping behavior against the shop-analytics MCP server.
 * The key challenge: the agent must discover the real schema (no `country` column,
 * all orders are in 2026 — not 2025) and creatively adapt its queries rather than
 * giving up or hallucinating.
 *
 * Expected ground-truth answers (precomputed from the live shop.db):
 *   Task 2 / Task 3 : No `country` column exists — agent must surface this fact.
 *   Task 4 : Дмитрий Харитонов <dmitriy.kharitonov845@mail.ru>, total ~785 750
 *   Task 5 : top-5 by units sold — Увлажнитель(109), Эспандер(101), Блендер(95), Планшет(94), Шапка(93)
 *   Task 6 : Электроника > Бытовая техника > Одежда и обувь
 *   Task 7 : No 2025 orders; all orders are from 2026 — agent must investigate & report
 *   Task 8 : София Яковлев, 16 orders
 */

import { EvalSuite } from '../types';

export const shopMcpEvalSuite: EvalSuite = {
  name: 'Shop MCP — Functional Task Evals',
  cases: [
    // -----------------------------------------------------------------------
    // Task 1 — Schema Discovery
    // -----------------------------------------------------------------------
    {
      name: 'Task 1 — Schema Discovery: list all tables with descriptions',
      input:
        'Show me all available tables and explain what information each table contains.',
      assert: ({ response, toolCalls }) => {
        // Agent must call the MCP schema tool (or execute a sqlite_master query)
        const schemaCall = toolCalls.find(
          c =>
            c.name === 'get_database_schema' ||
            c.name === 'execute_read_only_sql',
        );
        if (!schemaCall) {
          return { passed: false, error: 'No MCP tool was called at all' };
        }

        const lower = response.toLowerCase();

        // All four tables must be mentioned
        const tables = ['customers', 'products', 'orders', 'order_items'];
        for (const table of tables) {
          if (!lower.includes(table)) {
            return {
              passed: false,
              error: `Response does not mention table: ${table}`,
            };
          }
        }

        return { passed: true };
      },
    },

    // -----------------------------------------------------------------------
    // Task 2 — Simple Filtering (schema trap: no `country` column in customers)
    // A good agent will: (1) try the query, get an error, (2) check the schema,
    // (3) report that there is no country column (or find a creative workaround).
    // We test that the agent looped (made ≥2 MCP calls) and acknowledged reality.
    // -----------------------------------------------------------------------
    {
      name: 'Task 2 — Germany Customers: agent must handle missing country column',
      input: 'How many customers are from Germany?',
      assert: ({ response, toolCalls }) => {
        const mcpCalls = toolCalls.filter(
          c =>
            c.name === 'execute_read_only_sql' ||
            c.name === 'get_database_schema',
        );
        if (mcpCalls.length === 0) {
          return { passed: false, error: 'Agent did not call any MCP tool' };
        }

        const checkedSchema = toolCalls.some(c => c.name === 'get_database_schema');

        // If the agent didn't check the schema, it must have made at least 2 calls 
        // (an initial failing query + a follow-up query/check). 
        // If it checked the schema first, 1 call is sufficient!
        if (!checkedSchema && mcpCalls.length < 2) {
          return {
            passed: false,
            error:
              `Agent only made ${mcpCalls.length} MCP call(s) without checking the schema. ` +
              'Expected at least 2 calls if trying queries blindly (initial attempt + retry).',
          };
        }

        const lower = response.toLowerCase();

        // The response must acknowledge the missing column or equivalent finding
        const acknowledged =
          lower.includes('no') ||
          lower.includes('not') ||
          lower.includes('column') ||
          lower.includes('schema') ||
          lower.includes('unavailable') ||
          lower.includes('does not') ||
          lower.includes('cannot') ||
          lower.includes('unable');

        if (!acknowledged) {
          return {
            passed: false,
            error:
              'Response does not acknowledge that country data is unavailable. ' +
              `Response: ${response.slice(0, 300)}`,
          };
        }

        return { passed: true };
      },
    },

    // -----------------------------------------------------------------------
    // Task 3 — Aggregation & Grouping (also hits the no-country trap)
    // Agent must discover the schema mismatch and report intelligently.
    // -----------------------------------------------------------------------
    {
      name: 'Task 3 — Country with most customers: agent must handle missing country column',
      input: 'Which country has the most customers?',
      assert: ({ response, toolCalls }) => {
        const mcpCalls = toolCalls.filter(
          c =>
            c.name === 'execute_read_only_sql' ||
            c.name === 'get_database_schema',
        );
        if (mcpCalls.length === 0) {
          return { passed: false, error: 'Agent did not call any MCP tool' };
        }

        const checkedSchema = toolCalls.some(c => c.name === 'get_database_schema');

        // Must retry after discovering schema mismatch OR check schema explicitly
        if (!checkedSchema && mcpCalls.length < 2) {
          return {
            passed: false,
            error:
              `Agent only made ${mcpCalls.length} MCP call(s) without checking schema. ` +
              'Expected at least 2 calls if attempting queries blindly (initial attempt + retry).',
          };
        }

        const lower = response.toLowerCase();

        // Either the agent finds a creative workaround (e.g. email domain analysis)
        // or properly acknowledges that country data is not stored.
        const addressed =
          lower.includes('country') ||
          lower.includes('schema') ||
          lower.includes('column') ||
          lower.includes('no information') ||
          lower.includes('not available') ||
          lower.includes('cannot determine') ||
          lower.includes('does not contain') ||
          lower.includes('domain') || // creative email-domain workaround
          lower.includes('unable');

        if (!addressed) {
          return {
            passed: false,
            error:
              'Agent response does not address the missing country column. ' +
              `Response: ${response.slice(0, 300)}`,
          };
        }

        return { passed: true };
      },
    },

    // -----------------------------------------------------------------------
    // Task 4 — Top-spending customer (multi-table join required)
    // Ground truth: Дмитрий Харитонов, dmitriy.kharitonov845@mail.ru, ~785750
    // -----------------------------------------------------------------------
    {
      name: 'Task 4 — Top spender: correct name, email, and total',
      input: 'Who is the customer who spent the most money?',
      assert: ({ response, toolCalls }) => {
        const sqlCalls = toolCalls.filter(
          c => c.name === 'execute_read_only_sql',
        );
        if (sqlCalls.length === 0) {
          return {
            passed: false,
            error: 'execute_read_only_sql was never called',
          };
        }

        // Name check — Cyrillic or transliteration accepted
        const namePresent =
          response.includes('\u0414\u043c\u0438\u0442\u0440\u0438\u0439') ||
          response.includes('\u0425\u0430\u0440\u0438\u0442\u043e\u043d\u043e\u0432') ||
          response.toLowerCase().includes('dmitriy') ||
          response.toLowerCase().includes('kharitonov') ||
          response.toLowerCase().includes('dmitriy.kharitonov845@mail.ru');

        if (!namePresent) {
          return {
            passed: false,
            error:
              'Response does not contain the top-spending customer name (Dmitriy Kharitonov). ' +
              `Response: ${response.slice(0, 300)}`,
          };
        }

        // Email check
        if (!response.includes('dmitriy.kharitonov845@mail.ru')) {
          return {
            passed: false,
            error:
              'Response does not contain the correct email (dmitriy.kharitonov845@mail.ru). ' +
              `Response: ${response.slice(0, 300)}`,
          };
        }

        // Total amount check — accept values in 700k–900k range (rounding / join paths)
        const totalMatch = response.match(/[\d\s,.]+/g);
        const hasReasonableTotal = totalMatch?.some(m => {
          const n = parseFloat(m.replace(/[\s,]/g, ''));
          return n >= 700000 && n <= 900000;
        });
        if (!hasReasonableTotal) {
          return {
            passed: false,
            error:
              'Response does not contain a plausible total spend (~785750). ' +
              `Response: ${response.slice(0, 300)}`,
          };
        }

        return { passed: true };
      },
    },

    // -----------------------------------------------------------------------
    // Task 5 — Top 5 best-selling products (by units sold)
    // Ground truth: Увлажнитель AirFresh(109), Эспандер(101), Блендер(95),
    //               Планшет Tab 10(94), Шапка вязаная(93)
    // -----------------------------------------------------------------------
    {
      name: 'Task 5 — Top 5 products: names, units sold, revenue in response',
      input: 'What are the top 5 best-selling products?',
      assert: ({ response, toolCalls }) => {
        const sqlCalls = toolCalls.filter(
          c => c.name === 'execute_read_only_sql',
        );
        if (sqlCalls.length === 0) {
          return {
            passed: false,
            error: 'execute_read_only_sql was never called',
          };
        }

        // Response must contain numeric data for 5 items
        const numberMatches = response.match(/\d+/g) || [];
        if (numberMatches.length < 5) {
          return {
            passed: false,
            error:
              'Response does not appear to contain quantitative data for 5 products. ' +
              `Response: ${response.slice(0, 400)}`,
          };
        }

        // At least one expected top product must be mentioned
        const lower = response.toLowerCase();
        const expectedProducts = [
          '\u0443\u0432\u043b\u0430\u0436\u043d\u0438\u0442\u0435\u043b\u044c', // увлажнитель
          'airfresh',
          '\u044d\u0441\u043f\u0430\u043d\u0434\u0435\u0440', // эспандер
          '\u0431\u043b\u0435\u043d\u0434\u0435\u0440', // блендер
          '\u043f\u043b\u0430\u043d\u0448\u0435\u0442', // планшет
          '\u0448\u0430\u043f\u043a\u0430', // шапка
        ];
        const hasProduct = expectedProducts.some(p => lower.includes(p));
        if (!hasProduct) {
          return {
            passed: false,
            error:
              'Response does not mention any expected top-5 product name. ' +
              `Response: ${response.slice(0, 400)}`,
          };
        }

        return { passed: true };
      },
    },

    // -----------------------------------------------------------------------
    // Task 6 — Top 3 categories by revenue (multi-table join required)
    // Ground truth: Электроника > Бытовая техника > Одежда и обувь
    // -----------------------------------------------------------------------
    {
      name: 'Task 6 — Top 3 categories: correct category names in response',
      input: 'What are the top 3 product categories by revenue?',
      assert: ({ response, toolCalls }) => {
        const sqlCalls = toolCalls.filter(
          c => c.name === 'execute_read_only_sql',
        );
        if (sqlCalls.length === 0) {
          return {
            passed: false,
            error: 'execute_read_only_sql was never called',
          };
        }

        // Verify a JOIN query was attempted
        const joinQuery = sqlCalls.find(c => {
          const q = (c.args?.query || '').toLowerCase();
          return (
            q.includes('join') ||
            (q.includes('order_items') && q.includes('products'))
          );
        });
        if (!joinQuery) {
          return {
            passed: false,
            error:
              'Agent did not execute a JOIN query across order_items and products tables.',
          };
        }

        // Top revenue category must be present
        const lower = response.toLowerCase();
        const hasElectronics =
          lower.includes('\u044d\u043b\u0435\u043a\u0442\u0440\u043e\u043d\u0438\u043a\u0430') || // электроника
          lower.includes('electronics');
        if (!hasElectronics) {
          return {
            passed: false,
            error:
              'Response does not mention the top revenue category (Elektronika/Электроника). ' +
              `Response: ${response.slice(0, 400)}`,
          };
        }

        return { passed: true };
      },
    },

    // -----------------------------------------------------------------------
    // Task 7 — Revenue in 2025 (date trap: ALL 750 orders are in 2026)
    // Agent must: (1) filter by 2025 → empty result, (2) investigate date range,
    // (3) report the finding honestly (not just return zero silently).
    // -----------------------------------------------------------------------
    {
      name: 'Task 7 — 2025 revenue: agent must discover all orders are in 2026',
      input: 'How much revenue did we generate in 2025?',
      assert: ({ response, toolCalls }) => {
        const sqlCalls = toolCalls.filter(
          c => c.name === 'execute_read_only_sql',
        );
        if (sqlCalls.length === 0) {
          return {
            passed: false,
            error: 'execute_read_only_sql was never called',
          };
        }

        // Agent must have looped — initial 2025 query + follow-up date-range investigation
        if (sqlCalls.length < 2) {
          return {
            passed: false,
            error:
              `Agent made only ${sqlCalls.length} SQL call(s). ` +
              'Expected at least 2: a 2025-filtered query + a date-range investigation.',
          };
        }

        const lower = response.toLowerCase();

        // Agent must surface the 2026 reality or acknowledge no 2025 data
        const investigated =
          lower.includes('2026') ||
          lower.includes('no orders') ||
          lower.includes('no revenue') ||
          lower.includes('no data') ||
          lower.includes('no records') ||
          lower.includes('\u043d\u0435\u0442') || // Russian "нет"
          lower.includes('not found') ||
          lower.includes('zero');

        if (!investigated) {
          return {
            passed: false,
            error:
              'Agent did not investigate or report that no 2025 orders exist. ' +
              `Response: ${response.slice(0, 400)}`,
          };
        }

        return { passed: true };
      },
    },

    // -----------------------------------------------------------------------
    // Task 8 — Customer with most orders (join: customers + orders)
    // Ground truth: София Яковлев, 16 orders
    // -----------------------------------------------------------------------
    {
      name: 'Task 8 — Most orders: correct customer name and order count',
      input: 'Which customer placed the most orders?',
      assert: ({ response, toolCalls }) => {
        const sqlCalls = toolCalls.filter(
          c => c.name === 'execute_read_only_sql',
        );
        if (sqlCalls.length === 0) {
          return {
            passed: false,
            error: 'execute_read_only_sql was never called',
          };
        }

        // Verify a JOIN was used across customers + orders
        const joinQuery = sqlCalls.find(c => {
          const q = (c.args?.query || '').toLowerCase();
          return (
            q.includes('join') ||
            (q.includes('orders') && q.includes('customers'))
          );
        });
        if (!joinQuery) {
          return {
            passed: false,
            error:
              'Agent did not execute a JOIN across customers + orders tables.',
          };
        }

        // Name check — Cyrillic or transliteration
        const namePresent =
          response.includes('\u0421\u043e\u0444\u0438\u044f') || // София
          response.includes('\u042f\u043a\u043e\u0432\u043b\u0435\u0432') || // Яковлев
          response.toLowerCase().includes('sofiya') ||
          response.toLowerCase().includes('sofiia') ||
          response.toLowerCase().includes('yakovlev');

        if (!namePresent) {
          return {
            passed: false,
            error:
              'Response does not contain the correct customer name (Sofia Yakovlev). ' +
              `Response: ${response.slice(0, 300)}`,
          };
        }

        // Order count check
        if (!response.includes('16')) {
          return {
            passed: false,
            error:
              'Response does not mention the correct order count (16). ' +
              `Response: ${response.slice(0, 300)}`,
          };
        }

        return { passed: true };
      },
    },

    // -----------------------------------------------------------------------
    // Task 9 — Missing schema information (e.g., location/country)
    // Agent must check the schema and correctly report that the information
    // is not available, without hallucinating queries with non-existent columns.
    // -----------------------------------------------------------------------
    {
      name: 'Task 9 — Missing schema info: agent must report lack of data',
      input: 'How many customers are from Germany?',
      assert: ({ response, toolCalls }) => {
        // We expect the agent to check the schema
        const schemaCalls = toolCalls.filter(
          c =>
            c.name === 'get_database_schema' ||
            c.name === 'list_tables' ||
            c.name === 'describe_table',
        );
        if (schemaCalls.length === 0) {
          return {
            passed: false,
            error: 'Agent did not check the database schema to find location columns.',
          };
        }

        const lower = response.toLowerCase();

        // Agent must indicate that the schema lacks this information
        const reportedMissing =
          lower.includes('not include') ||
          lower.includes('cannot determine') ||
          lower.includes('not available') ||
          lower.includes('no column') ||
          lower.includes('no field') ||
          lower.includes('missing') ||
          lower.includes("don't have") ||
          lower.includes('do not have') ||
          lower.includes('no location') ||
          lower.includes('no country') ||
          lower.includes('does not specify');

        if (!reportedMissing) {
          return {
            passed: false,
            error:
              'Agent did not state that the country/location information is missing from the database. ' +
              `Response: ${response.slice(0, 300)}`,
          };
        }

        return { passed: true };
      },
    },
  ],
};
