'use client';

import * as React from 'react';
import {
  chatGptUrl,
  claudeUrl,
  cursorDeeplink,
  grokUrl,
  perplexityUrl,
  safeOrigin,
  vscodeDeeplink,
} from './ai-tool-menu';

/**
 * Per-page actions: "Copy as Markdown" and an "Open" menu (view the raw
 * Markdown, or hand the page to ChatGPT/Claude/Cursor/…).
 *
 * These are the page-level companions to the framework's `*.md` endpoint
 * (see ./markdown.ts): `MarkdownCopyButton` fetches the page's own `.md`
 * document and puts it on the clipboard, and `ViewOptionsPopover` links to
 * the same `.md` URL plus the AI tools.
 *
 * Both are Client Components and take only serializable props (an `icons`
 * map of pre-rendered ReactNode per tool, mirroring AiToolMenu — a live
 * function prop can't cross the Server → Client boundary).
 */

/* ─────────────────────────────────────────────
   MarkdownCopyButton
───────────────────────────────────────────── */

// Cache the fetched Markdown per URL so copying the same page twice doesn't
// refetch. Keyed by the URL string; a module-level map like SearchDialog's
// pagefindPromise.
const markdownCache = new Map<string, Promise<string>>();

export interface MarkdownCopyButtonProps {
  /**
   * URL of this page's Markdown document, e.g. `/quickstart.md`. Fetched and
   * copied verbatim.
   */
  markdownUrl: string;
  /** Button label. Defaults to "Copy Markdown". */
  label?: string;
  /** Pre-rendered icon; falls back to a small built-in glyph. */
  icon?: React.ReactNode;
  /** Extra class name on the <button>. */
  className?: string;
}

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

/**
 * Fetches this page's Markdown (`markdownUrl`) and copies it to the
 * clipboard. Cached per URL; shows a check briefly after a successful copy.
 */
export function MarkdownCopyButton({
  markdownUrl,
  label = 'Copy Markdown',
  icon,
  className,
}: MarkdownCopyButtonProps) {
  const [copied, setCopied] = React.useState(false);
  const [loading, setLoading] = React.useState(false);

  async function handleCopy() {
    if (loading) return;
    setLoading(true);
    try {
      let promise = markdownCache.get(markdownUrl);
      if (!promise) {
        promise = fetch(markdownUrl).then((res) => res.text());
        markdownCache.set(markdownUrl, promise);
      }
      const ok = await copyText(await promise);
      if (ok) {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }
    } catch {
      // fetch failed — nothing to copy; leave the button unchanged
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      type="button"
      className={`fw-page-action${className ? ` ${className}` : ''}${copied ? ' fw-page-action--copied' : ''}`}
      onClick={() => void handleCopy()}
      disabled={loading}
      aria-label={copied ? 'Copied' : label}
      title={label}
    >
      <span className="fw-page-action-icon" aria-hidden>
        {copied ? <CheckGlyph /> : (icon ?? <CopyGlyph />)}
      </span>
      <span className="fw-page-action-label">{copied ? 'Copied!' : label}</span>
    </button>
  );
}

/* ─────────────────────────────────────────────
   ViewOptionsPopover
───────────────────────────────────────────── */

export interface ViewOptionsPopoverProps {
  /**
   * URL of this page's Markdown document, e.g. `/quickstart.md`. Renders the
   * "View as Markdown" entry. Omit to hide it.
   */
  markdownUrl?: string;
  /** Absolute URL of the page itself — used to build the AI-tool prompt links. */
  pageUrl?: string;
  /** Source file URL on GitHub, e.g. `https://github.com/…/blob/…/quickstart.mdx`. */
  githubUrl?: string;
  /**
   * Absolute URL of this site's own MCP endpoint (mount one via
   * `createMcpHandler()` from '@inkform/framework/mcp'). Defaults to
   * `${origin}/api/mcp`. Pass `null` to omit the Cursor/VS Code entries.
   */
  mcpUrl?: string | null;
  /** Shown to Cursor/VS Code as the installed MCP server's label. Defaults to 'Docs'. */
  siteName?: string;
  /** Trigger button label. Defaults to "Open". */
  triggerLabel?: string;
  /**
   * Pre-rendered icon per tool (e.g. Lucide elements), keyed by tool id.
   * Mirrors AiToolMenu's `icons` prop; falls back to built-in glyphs.
   */
  icons?: Partial<Record<string, React.ReactNode>>;
  /** Extra class name on the wrapper. */
  className?: string;
}

function ExternalGlyph() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M7 17 17 7" />
      <path d="M8 7h9v9" />
    </svg>
  );
}

function TextGlyph() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 7V4h16v3" />
      <path d="M9 20h6" />
      <path d="M12 4v16" />
    </svg>
  );
}

/**
 * An "Open" dropdown with a "View as Markdown" link (the page's own `.md`
 * document) and "hand this page to an AI tool" links — ChatGPT, Claude,
 * Cursor, VS Code, Perplexity, Grok — reusing the same URL builders as
 * AiToolMenu. Closes on Escape or an outside click.
 */
export function ViewOptionsPopover({
  markdownUrl,
  pageUrl,
  githubUrl,
  mcpUrl,
  siteName = 'Docs',
  triggerLabel = 'Open',
  icons,
  className,
}: ViewOptionsPopoverProps) {
  const [open, setOpen] = React.useState(false);
  const rootRef = React.useRef<HTMLDivElement>(null);

  // Page URL resolves client-side (SSG pages have no request context), same
  // as AiToolMenu — `pageUrl` only prevents a brief blank before mount.
  const [liveUrl, setLiveUrl] = React.useState<string | undefined>(pageUrl);
  const [liveOrigin, setLiveOrigin] = React.useState<string | undefined>(() =>
    pageUrl ? safeOrigin(pageUrl) : undefined,
  );

  React.useEffect(() => {
    setLiveUrl(window.location.href);
    setLiveOrigin(window.location.origin);
  }, []);

  React.useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    function onPointer(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onPointer);
    };
  }, [open]);

  const resolvedUrl = liveUrl ?? '';
  const resolvedMcpUrl = mcpUrl === null ? null : (mcpUrl ?? (liveOrigin ? `${liveOrigin}/api/mcp` : null));

  const items: { id: string; label: string; href: string }[] = [];
  if (githubUrl) items.push({ id: 'github', label: 'Open in GitHub', href: githubUrl });
  if (markdownUrl) items.push({ id: 'markdown', label: 'View as Markdown', href: markdownUrl });
  if (resolvedUrl) {
    items.push({ id: 'chatgpt', label: 'Open in ChatGPT', href: chatGptUrl(resolvedUrl) });
    items.push({ id: 'claude', label: 'Open in Claude', href: claudeUrl(resolvedUrl) });
  }
  if (resolvedMcpUrl) {
    items.push({ id: 'cursor', label: 'Connect to Cursor', href: cursorDeeplink(siteName, resolvedMcpUrl) });
    items.push({ id: 'vscode', label: 'Connect to VS Code', href: vscodeDeeplink(siteName, resolvedMcpUrl) });
  }
  if (resolvedUrl) {
    items.push({ id: 'perplexity', label: 'Open in Perplexity', href: perplexityUrl(resolvedUrl) });
    items.push({ id: 'grok', label: 'Open in Grok', href: grokUrl(resolvedUrl) });
  }

  function icon(id: string): React.ReactNode {
    if (icons?.[id]) return icons[id] as React.ReactNode;
    if (id === 'markdown') return <TextGlyph />;
    return <ExternalGlyph />;
  }

  return (
    <div ref={rootRef} className={`fw-page-action-group${className ? ` ${className}` : ''}`}>
      <button
        type="button"
        className={`fw-page-action${open ? ' fw-page-action--open' : ''}`}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={triggerLabel}
        title={triggerLabel}
      >
        <span className="fw-page-action-label">{triggerLabel}</span>
        <svg className="fw-page-action-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open ? (
        <div className="fw-page-action-menu" role="menu" aria-label={triggerLabel}>
          {items.map((item) => (
            <a
              key={item.id}
              role="menuitem"
              href={item.href}
              target="_blank"
              rel="noreferrer noopener"
              className="fw-page-action-menu-item"
            >
              <span className="fw-page-action-menu-icon" aria-hidden>
                {icon(item.id)}
              </span>
              <span className="fw-page-action-menu-label">{item.label}</span>
            </a>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/* ─────────────────────────────────────────────
   PageActions — both buttons in one row
───────────────────────────────────────────── */

export interface PageActionsProps extends ViewOptionsPopoverProps {
  /** URL of this page's Markdown document, e.g. `/quickstart.md`. */
  markdownUrl: string;
  /** Label for the copy button. Defaults to "Copy Markdown". */
  copyLabel?: string;
  /** Pre-rendered copy icon. */
  copyIcon?: React.ReactNode;
}

/**
 * The two page-level actions side by side: Copy as Markdown + Open.
 *
 * ```tsx
 * <PageActions
 *   markdownUrl={`/${ref.slug}.md`}
 *   githubUrl={`https://github.com/${owner}/${repo}/blob/main/content/docs/${ref.file}`}
 * />
 * ```
 */
export function PageActions(props: PageActionsProps) {
  const { markdownUrl, copyLabel, copyIcon, className, ...popoverProps } = props;
  return (
    <div className={`fw-page-actions${className ? ` ${className}` : ''}`}>
      <MarkdownCopyButton markdownUrl={markdownUrl} label={copyLabel} icon={copyIcon} />
      <ViewOptionsPopover markdownUrl={markdownUrl} {...popoverProps} />
    </div>
  );
}
