import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { Agent } from 'undici';
import { Tool } from '../types';

const REQUEST_TIMEOUT_MS = 15_000;
const MAX_BODY_BYTES = 1_000_000;
const MAX_REDIRECTS = 5;

// Mutable so tests can stub DNS resolution without touching the real network.
export const _internal = { lookup };

function allowPrivate(): boolean {
  return process.env.CURL_ALLOW_PRIVATE === 'true';
}

// IPv4 private/loopback/link-local ranges, plus the IPv6 equivalents
// (loopback, link-local, unique-local) and v4-mapped v6 addresses.
function isBlockedAddress(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) {
    const [a, b] = ip.split('.').map(Number);
    if (a === 127) return true; // loopback
    if (a === 10) return true; // private
    if (a === 172 && b >= 16 && b <= 31) return true; // private
    if (a === 192 && b === 168) return true; // private
    if (a === 169 && b === 254) return true; // link-local
    if (a === 0) return true; // "this network"
    return false;
  }
  if (family === 6) {
    const lower = ip.toLowerCase();
    if (lower === '::1') return true; // loopback
    if (lower.startsWith('fe80:') || lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')) return true; // link-local
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // unique local
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isBlockedAddress(mapped[1]);
    return false;
  }
  return false;
}

function stripBrackets(hostname: string): string {
  return hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;
}

// Validates at connect time, using the very addresses the socket will dial, so a
// DNS answer that changes between a pre-check and the connection cannot slip through.
const guardedDispatcher = new Agent({
  connect: {
    lookup: (hostname: string, options: any, callback: any) => {
      _internal.lookup(hostname, { all: true }).then((addresses) => {
        const bad = addresses.find(({ address }) => isBlockedAddress(address));
        if (bad) {
          callback(new Error(`Request blocked: '${hostname}' resolves to loopback/private/link-local address ${bad.address}`));
        } else if (options?.all) {
          callback(null, addresses);
        } else {
          callback(null, addresses[0].address, addresses[0].family);
        }
      }, callback);
    },
  },
});

async function assertHostAllowed(rawHostname: string): Promise<void> {
  if (allowPrivate()) return;
  const hostname = stripBrackets(rawHostname);
  const direct = isIP(hostname);
  if (direct) {
    if (isBlockedAddress(hostname)) {
      throw new Error(`Request blocked: '${hostname}' is a loopback/private/link-local address`);
    }
    return;
  }
  const addresses = await _internal.lookup(hostname, { all: true });
  for (const { address } of addresses) {
    if (isBlockedAddress(address)) {
      throw new Error(`Request blocked: '${hostname}' resolves to loopback/private/link-local address ${address}`);
    }
  }
}

async function readCapped(response: Response, maxBytes: number): Promise<{ text: string; truncated: boolean }> {
  const reader = response.body?.getReader();
  if (!reader) {
    const text = await response.text();
    return text.length > maxBytes ? { text: text.slice(0, maxBytes), truncated: true } : { text, truncated: false };
  }

  const decoder = new TextDecoder();
  let text = '';
  let truncated = false;
  let bytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > maxBytes) {
      const allowed = value.byteLength - (bytes - maxBytes);
      text += decoder.decode(value.slice(0, Math.max(allowed, 0)));
      truncated = true;
      await reader.cancel();
      break;
    }
    text += decoder.decode(value, { stream: true });
  }
  return { text, truncated };
}

export const curlTool: Tool = {
  name: 'curl',
  description: 'Make an HTTP(S) request to a URL and return the response. Equivalent to the curl command. Blocks requests to loopback, link-local and private-range addresses by default, caps response size and applies a timeout.',
  parameters: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'The URL to make a request to.'
      },
      method: {
        type: 'string',
        description: 'The HTTP method (e.g. GET, POST). Defaults to GET.'
      },
      headers: {
        type: 'object',
        description: 'Optional HTTP headers as a key-value object.'
      },
      body: {
        type: 'string',
        description: 'Optional request body string for POST/PUT requests.'
      }
    },
    required: ['url']
  },
  async execute(args: Record<string, any>): Promise<any> {
    const url = args.url;
    if (!url) {
      throw new Error("Missing 'url' argument");
    }

    try {
      let headers = args.headers || {};
      if (typeof headers === 'string') {
        try { headers = JSON.parse(headers); } catch (e) { }
      }

      const options: RequestInit & { dispatcher?: unknown } = {
        method: args.method || 'GET',
        headers: headers,
        redirect: 'manual',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      };
      if (!allowPrivate()) options.dispatcher = guardedDispatcher;

      if (args.body) {
        options.body = args.body;
      }

      let currentUrl = new URL(url);
      let response: Response;
      let redirects = 0;

      while (true) {
        if (currentUrl.protocol !== 'http:' && currentUrl.protocol !== 'https:') {
          throw new Error(`Unsupported protocol '${currentUrl.protocol}'; only http(s) is allowed`);
        }
        await assertHostAllowed(currentUrl.hostname);

        response = await fetch(currentUrl, options);

        if (response.status >= 300 && response.status < 400 && response.headers.has('location')) {
          if (++redirects > MAX_REDIRECTS) {
            throw new Error('Too many redirects');
          }
          const nextUrl = new URL(response.headers.get('location')!, currentUrl);
          if (nextUrl.origin !== currentUrl.origin) {
            options.headers = Object.fromEntries(
              Object.entries(options.headers as Record<string, string>).filter(
                ([name]) => !['authorization', 'cookie', 'proxy-authorization'].includes(name.toLowerCase())
              )
            );
          }
          currentUrl = nextUrl;
          continue;
        }
        break;
      }

      const { text, truncated } = await readCapped(response, MAX_BODY_BYTES);

      return {
        status: response.status,
        statusText: response.statusText,
        headers: Object.fromEntries(response.headers.entries()),
        data: text,
        truncated
      };
    } catch (e: any) {
      throw new Error(`HTTP Request failed: ${e.cause?.message ?? e.message}`);
    }
  }
};
