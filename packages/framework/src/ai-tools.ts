/**
 * AI tool registry — the "hand this page to an AI tool" links used by both
 * AiToolMenu and PageActions. Pure data + one resolver, instead of one
 * function per tool.
 *
 * Two kinds:
 * - `prompt` — a web tool that takes the page URL and pre-fills a prompt in a
 *   query param (`Open in ChatGPT`, `Open in Claude`, ...).
 * - `mcp` — an editor deeplink that installs THIS SITE'S OWN MCP server (see
 *   '@inkform/framework/mcp') into the reader's editor (`Connect to Cursor`,
 *   `Connect to VS Code`). Different encodings per editor, hence `format`.
 */

export type AiToolId = 'chatgpt' | 'claude' | 'google' | 'cursor' | 'vscode' | 'perplexity' | 'grok';

interface PromptTool {
  kind: 'prompt';
  id: AiToolId;
  label: string;
  /** Base URL, e.g. `https://chatgpt.com/`. */
  base: string;
  /** Query param the prompt goes in, e.g. `prompt` or `q`. */
  param: string;
  /** Extra fixed query params, e.g. `{ hints: 'search' }`. */
  extra?: Record<string, string>;
}

interface McpTool {
  kind: 'mcp';
  id: AiToolId;
  label: string;
  /** How to encode the MCP install deeplink. */
  format: 'cursor' | 'vscode';
}

export type AiTool = PromptTool | McpTool;

/** The prompt every web tool receives — read the page, ask about it. */
export function buildPrompt(pageUrl: string): string {
  return `Read ${pageUrl} and help me understand it`;
}

export const AI_TOOLS: AiTool[] = [
  { kind: 'prompt', id: 'chatgpt', label: 'Open in ChatGPT', base: 'https://chatgpt.com/', param: 'prompt', extra: { hints: 'search' } },
  { kind: 'prompt', id: 'claude', label: 'Open in Claude', base: 'https://claude.ai/new', param: 'q' },
  { kind: 'prompt', id: 'google', label: 'Google it', base: 'https://www.google.com/search', param: 'q' },
  { kind: 'mcp', id: 'cursor', label: 'Connect to Cursor', format: 'cursor' },
  { kind: 'mcp', id: 'vscode', label: 'Connect to VS Code', format: 'vscode' },
  { kind: 'prompt', id: 'perplexity', label: 'Open in Perplexity', base: 'https://www.perplexity.ai/search', param: 'q' },
  { kind: 'prompt', id: 'grok', label: 'Open in Grok', base: 'https://grok.com/', param: 'q' },
];

/** Unicode-safe base64 (btoa() alone only handles Latin1) — guards a siteName with non-ASCII characters. */
export function safeBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

export function safeOrigin(url: string): string | undefined {
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
}

function mcpInstallHref(format: McpTool['format'], siteName: string, mcpUrl: string): string {
  if (format === 'cursor') {
    // Cursor's documented one-click MCP install deep link:
    //   cursor://anysphere.cursor-deeplink/mcp/install?name=<name>&config=<base64 JSON>
    const config = safeBase64(JSON.stringify({ url: mcpUrl }));
    return `cursor://anysphere.cursor-deeplink/mcp/install?name=${encodeURIComponent(siteName)}&config=${config}`;
  }
  // VS Code's documented MCP install URI: vscode:mcp/install?<url-encoded JSON>
  // — note the query segment IS the encoded JSON, not key=value pairs.
  return `vscode:mcp/install?${encodeURIComponent(JSON.stringify({ name: siteName, url: mcpUrl }))}`;
}

export interface BuildAiToolHrefOptions {
  /** Page URL — required for `prompt` tools. */
  pageUrl?: string;
  /** MCP endpoint — required for `mcp` tools. */
  mcpUrl?: string;
  /** Shown to Cursor/VS Code as the installed MCP server's label. Defaults to 'Docs'. */
  siteName?: string;
}

/** Build one tool's href from the registry. Returns null when a prerequisite is missing. */
export function buildAiToolHref(tool: AiTool, options: BuildAiToolHrefOptions): string | null {
  if (tool.kind === 'mcp') {
    if (!options.mcpUrl) return null;
    return mcpInstallHref(tool.format, options.siteName ?? 'Docs', options.mcpUrl);
  }
  if (!options.pageUrl) return null;
  const url = new URL(tool.base);
  url.searchParams.set(tool.param, buildPrompt(options.pageUrl));
  for (const [key, value] of Object.entries(tool.extra ?? {})) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

export function aiTool(id: AiToolId): AiTool | undefined {
  return AI_TOOLS.find((t) => t.id === id);
}
