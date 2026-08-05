'use client';

import * as React from 'react';
import { AI_TOOLS, buildAiToolAction, buildPrompt, safeOrigin, type AiToolId } from './ai-tools';

/**
 * AiToolMenu — a right-rail list of "hand this page to an AI tool" actions:
 * Copy page (raw Markdown), Open in ChatGPT/Claude/Perplexity/Grok (a
 * pre-filled prompt), Connect to Cursor/VS Code (installs THIS SITE'S OWN
 * MCP server — see '@inkform/framework/mcp' — into the reader's editor).
 *
 * Tool definitions (labels, URLs, query params) live in ./ai-tools — a data
 * registry, not per-tool functions.
 * Ties into this framework's existing llms.txt/MCP work: the Cursor/VS Code
 * items are only meaningful because a theme can mount `createMcpHandler()`
 * (./mcp) at a real route in a couple of lines; this component is otherwise
 * independent of that and degrades gracefully (see `mcpUrl`) if no MCP route
 * exists.
 *
 * Framework components don't bundle an icon library (see ARCHITECTURE.md
 * §5) — `renderIcon` follows the same convention as Sidebar/DocsShell's own
 * `renderIcon` prop. Without one, a small brand-neutral built-in glyph is
 * used (a generic "copy" icon, and a generic external-link arrow for every
 * other item) rather than reproducing any tool's actual logo mark.
 */

/* ─────────────────────────────────────────────
   Types
───────────────────────────────────────────── */

export type { AiToolId };
export { buildPrompt };

export interface AiToolMenuProps {
  /**
   * Raw Markdown/MDX of the current page. "Copy page" writes this verbatim
   * to the clipboard — the same idea as GitHub/Mintlify's own "Copy page"
   * buttons. Falls back to copying the page URL when omitted.
   */
  pageContent?: string;
  /**
   * Absolute URL of the current page (e.g. "https://docs.example.com/quickstart").
   * Used as the pre-hydration href so links aren't briefly blank; every link
   * recomputes from `window.location.href` right after mount regardless, so
   * this is correct even when omitted or stale — it only prevents a same-URL
   * flash on first paint. (SSG pages don't have request context to compute
   * this server-side without opting the whole page out of static generation,
   * so the framework doesn't do that for you — see Canopy's page.tsx for the
   * "pass nothing, let it self-resolve client-side" default.)
   */
  pageUrl?: string;
  /**
   * Absolute URL of this site's own MCP endpoint (mount one via
   * `createMcpHandler()` from '@inkform/framework/mcp' — ARCHITECTURE.md
   * §8). Defaults to `${location.origin}/api/mcp`. Pass `null` to omit
   * "Connect to Cursor" / "Connect to VS Code" entirely, e.g. a site that
   * hasn't mounted an MCP route.
   */
  mcpUrl?: string | null;
  /** Shown to Cursor/VS Code as the installed MCP server's label. Defaults to 'Docs'. */
  siteName?: string;
  /**
   * Absolute path to the site's own checkout on the reader's machine — used by opencode's deep link (`directory`). opencode requires a real path to prefill the prompt; without it the app still opens (falls back to `~`). Per-machine; pass your own docs repo path.
   */
  directory?: string;
  /** Section heading, or `null` to omit it (e.g. stacking under a TocList that already renders "On this page"). */
  title?: string | null;
  /**
   * Pre-rendered icon per tool (e.g. Lucide elements), keyed by `AiToolId`.
   * A plain ReactNode map rather than a `renderIcon` callback — this
   * component is a Client Component, and a live function prop can't cross
   * the Server → Client Component boundary from a page.tsx that builds this
   * server-side (confirmed the hard way: `next build` fails with "Functions
   * cannot be passed directly to Client Components" if you try). Build the
   * map once with real icons (e.g. a small constant in lib/icons.tsx) and
   * pass it down as data, the same way Sidebar/DocsShell's own `renderIcon`
   * convention resolves icons into ReactNode server-side before they ever
   * reach a component. Falls back to a small built-in glyph per tool for any
   * id not present in the map.
   */
  icons?: Partial<Record<AiToolId, React.ReactNode>>;
  /** Extra class name on the root <nav>. */
  className?: string;
}

/* ─────────────────────────────────────────────
   Default icons — dependency-free, brand-neutral (no framework package
   bundles an icon library; see ARCHITECTURE.md §5). A theme can pass real
   per-tool icons via `renderIcon`.
───────────────────────────────────────────── */

function CopyGlyph() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function CheckGlyph() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function ExternalGlyph() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M7 17 17 7" />
      <path d="M8 7h9v9" />
    </svg>
  );
}

function defaultIcon(tool: AiToolId): React.ReactNode {
  return <ExternalGlyph />;
}

/* ─────────────────────────────────────────────
   Copy-to-clipboard, with a fallback for contexts without the async
   Clipboard API (e.g. non-HTTPS dev over a LAN IP).
───────────────────────────────────────────── */

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to the legacy path below
  }
  try {
    const el = document.createElement('textarea');
    el.value = text;
    el.style.position = 'fixed';
    el.style.opacity = '0';
    document.body.appendChild(el);
    el.select();
    document.execCommand('copy');
    document.body.removeChild(el);
    return true;
  } catch {
    return false;
  }
}

/* ─────────────────────────────────────────────
   AiToolMenu
───────────────────────────────────────────── */

export function AiToolMenu({
  pageContent,
  pageUrl,
  mcpUrl,
  siteName = 'Docs',
  directory,
  title = 'Ask AI',
  icons,
  className,
}: AiToolMenuProps): React.ReactNode {
  const [copied, setCopied] = React.useState(false);
  const [commandCopied, setCommandCopied] = React.useState<string | null>(null);

  // See the `pageUrl` prop doc above: both the server pass and the first
  // client pass (before the effect below fires) render from the same
  // `pageUrl` fallback, so there's no hydration mismatch — the effect's
  // setState only triggers an ordinary post-hydration re-render, same as
  // any other client-only data (TocList's own scroll-spy state works the
  // same way).
  const [liveUrl, setLiveUrl] = React.useState<string | undefined>(pageUrl);
  const [liveOrigin, setLiveOrigin] = React.useState<string | undefined>(() => (pageUrl ? safeOrigin(pageUrl) : undefined));

  React.useEffect(() => {
    setLiveUrl(window.location.href);
    setLiveOrigin(window.location.origin);
  }, []);

  const resolvedUrl = liveUrl ?? '';
  const resolvedMcpUrl = mcpUrl === null ? null : (mcpUrl ?? (liveOrigin ? `${liveOrigin}/api/mcp` : null));

  async function handleCopy() {
    const ok = await copyText(pageContent || resolvedUrl);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  function icon(tool: AiToolId): React.ReactNode {
    return icons?.[tool] ?? defaultIcon(tool);
  }

  // Walk the registry (./ai-tools) once per render. Each tool resolves its
  // href from a prerequisite: prompt tools need a page URL, MCP tools need a
  // resolved MCP endpoint.
  const links: { id: AiToolId; label: string; action: { type: 'link'; href: string } | { type: 'command'; command: string } }[] = [];
  for (const tool of AI_TOOLS) {
    const action = buildAiToolAction(tool, {
      pageUrl: resolvedUrl,
      mcpUrl: resolvedMcpUrl ?? undefined,
      siteName,
    });
    if (action !== null) links.push({ id: tool.id, label: tool.label, action });
  }

  async function copyCommand(id: string, command: string) {
    if (await copyText(command)) {
      setCommandCopied(id);
      setTimeout(() => setCommandCopied((current) => (current === id ? null : current)), 1500);
    }
  }

  return (
    <nav className={`fw-aitoolmenu${className ? ` ${className}` : ''}`} aria-label="AI tools">
      {title ? <p className="fw-aitoolmenu-title">{title}</p> : null}
      <ul className="fw-aitoolmenu-list">
        <li className="fw-aitoolmenu-item">
          <button
            type="button"
            className={`fw-aitoolmenu-link${copied ? ' fw-aitoolmenu-link--copied' : ''}`}
            onClick={() => void handleCopy()}
          >
            <span className="fw-aitoolmenu-icon">{copied ? <CheckGlyph /> : <CopyGlyph />}</span>
            <span className="fw-aitoolmenu-label">{copied ? 'Copied!' : 'Copy page'}</span>
          </button>
        </li>
        {links.map((l) => {
          if (l.action.type === 'command') {
            const command = l.action.command;
            return (
              <li key={l.id} className="fw-aitoolmenu-item">
                <button
                  type="button"
                  className="fw-aitoolmenu-link"
                  onClick={() => void copyCommand(l.id, command)}
                >
                  <span className="fw-aitoolmenu-icon">{commandCopied === l.id ? <CheckGlyph /> : icon(l.id)}</span>
                  <span className="fw-aitoolmenu-label">{commandCopied === l.id ? 'Copied!' : l.label}</span>
                </button>
              </li>
            );
          }
          return (
            <li key={l.id} className="fw-aitoolmenu-item">
              <a className="fw-aitoolmenu-link" href={l.action.href} target="_blank" rel="noopener noreferrer">
                <span className="fw-aitoolmenu-icon">{icon(l.id)}</span>
                <span className="fw-aitoolmenu-label">{l.label}</span>
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
