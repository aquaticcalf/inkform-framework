/**
 * @inkform/framework — per-page Markdown (`*.md`).
 *
 * Any page on the site is also reachable as a single Markdown document by
 * appending `.md` to its own URL: `/quickstart.md`, `/index.md`,
 * `/concepts/pagination.md`, `/api-reference/operations/get-pokemon.md`. A
 * middleware rewrite (in the app's `proxy.ts`) maps those `.md` URLs onto the
 * internal markdown route; the public URL keeps its `.md` suffix.
 *
 * Three pieces:
 *
 * 1. `processMarkdown()` — converts an MDX source string (the body an author
 *    commits, e.g. `loadDocPage().content`) into a cleaned, LLM-readable
 *    Markdown string. It parses with the SAME plugins `<Mdx>` renders with
 *    (remark-gfm, remark-directive, remark-mdx) and re-stringifies the
 *    resulting mdast via `mdast-util-to-markdown` — deliberately NOT a regex
 *    strip, which would silently lose data-bearing components.
 *
 *    Component policy (nothing is dropped unless it's pure machinery):
 *    - `mdxjsEsm` (imports/exports) → removed. This is the "a component that
 *      imports another component / another .mdx" answer: the import machinery
 *      disappears, but every `<Thing />` *use site* stays in the output.
 *    - `:::callout` directives → blockquote (the closest markdown-native
 *      shape for what `<Mdx>` maps onto `<Callout>`).
 *    - Pure layout wrappers (`Tabs`, `Tab`, `CodeGroup`, `Columns`) →
 *      children-only: the tag collapses, the inner content stays.
 *    - Every other MDX component → the JSX tag is KEPT with its attributes,
 *      with children nested inside. So `<Playground template="react" />`,
 *      `<ApiReference endpoint="GET /pokemon" />`, and
 *      `<ApiLink operationId="get-pokemon">Get a Pokémon</ApiLink>` all survive
 *      verbatim — prop-carried data is never lost, and `{expr}` expressions
 *      are left as-is (unresolvable without executing the component).
 *
 * 2. `buildMarkdownPage()` — resolves a slug to the Markdown for ONE page:
 *    a doc page, an API operation (`<apiBase>/operations/<operationId>`), a
 *    blog post, or a changelog entry. The per-page counterpart to
 *    `buildLlmsFullTxt()` (whole corpus) and the MCP tools' `getDoc()`.
 *    Each page gets a `# title` + `URL:` header so agents know where the
 *    content came from.
 *
 * 3. `createMarkdownHandler()` — a Next.js route-handler factory (mirrors
 *    `createMcpHandler`). Mount it at `app/markdown/[[...slug]]/route.ts`:
 *
 *    ```ts
 *    // app/markdown/[[...slug]]/route.ts
 *    import { createMarkdownHandler } from '@inkform/framework/markdown';
 *    import { apiBasePath, loadDocsConfig } from '@/lib/route';
 *
 *    export const runtime = 'nodejs';
 *    export const GET = createMarkdownHandler({
 *      apiBasePath: (() => {
 *        const config = loadDocsConfig();
 *        return config && apiBasePath(config) ? apiBasePath(config) : undefined;
 *      })(),
 *    });
 *    ```
 *
 *    The handler reads the slug from Next's `[[...slug]]` params — the same
 *    resolution the docs page uses. The app's `proxy.ts` rewrites any
 *    `/<slug>.md` URL onto this route (public URL unchanged), so
 *    `/quickstart.md` and `/index.md` map to the same pages as `/quickstart`
 *    and `/`. Unknown pages return 404.
 */

import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkDirective from 'remark-directive';
import remarkMdx from 'remark-mdx';
import { toMarkdown } from 'mdast-util-to-markdown';
import { gfmToMarkdown } from 'mdast-util-gfm';
import { mdxToMarkdown } from 'mdast-util-mdx';
import { mdxJsxToMarkdown } from 'mdast-util-mdx-jsx';
import { visit } from 'unist-util-visit';
import type { Node, Root } from 'mdast';
import { loadBlogPost, loadChangelogEntries, loadDocPage, loadDocsConfig } from './content';
import { findDocPage } from './nav';
import { loadApiDocument } from './mcp/tools';
import { renderOperationMarkdown } from './openapi-engine/markdown';

/**
 * Pure layout wrappers — the tag carries no content of its own, so only the
 * inner content survives. Everything else keeps its JSX tag (props are data;
 * see the module docstring).
 */
const LAYOUT_WRAPPERS = new Set(['Tabs', 'Tab', 'CodeGroup', 'Columns']);

/** mdast-util-mdx-jsx's own to-markdown handlers, so we can delegate to them. */
const mdxJsxHandlers = mdxJsxToMarkdown().handlers!;
const mdxFlowHandler = mdxJsxHandlers.mdxJsxFlowElement!;
const mdxTextHandler = mdxJsxHandlers.mdxJsxTextElement!;

/**
 * Pre-stringify transforms that are easier expressed as tree edits than as
 * toMarkdown handlers:
 * - drop `mdxjsEsm` (imports/exports are machinery, not content)
 * - `:::callout` directives → blockquote
 * - leaf/text directives → their children (or drop when empty)
 */
function remarkPlainMarkdown() {
  return (tree: Root) => {
    visit(tree, (node, index, parent) => {
      if (!parent || index === undefined) return;
      const n = node as unknown as { type: string; children?: Node[] };

      switch (n.type) {
        case 'mdxjsEsm':
          (parent.children as unknown[]).splice(index, 1);
          return;
        case 'containerDirective': {
          // `:::info … :::` maps to <Callout type="info"> when rendered; the
          // closest markdown-native shape is a blockquote.
          const directive = n as { type: string; name?: unknown; attributes?: unknown };
          directive.type = 'blockquote';
          delete directive.name;
          delete directive.attributes;
          return;
        }
        case 'leafDirective':
        case 'textDirective': {
          const children = n.children;
          // Replace the directive node with its children (or drop it entirely).
          (parent.children as unknown[]) = [
            ...(parent.children as unknown[]).slice(0, index),
            ...(children ?? []),
            ...(parent.children as unknown[]).slice(index + 1),
          ];
          return;
        }
      }
    });
  };
}

/**
 * Convert an MDX source string into cleaned, LLM-readable Markdown. See the
 * module docstring for the component policy. Pure — no IO.
 */
export function processMarkdown(source: string): string {
  // `.parse()` only runs the parsers; the transformer plugins (remarkGfm's
  // table/task handling, remarkDirective, remarkPlainMarkdown) run in
  // `.run()` — so parse first, then run the transformers, then stringify.
  const processor = unified()
    .use(remarkParse)
    .use(remarkMdx)
    .use(remarkGfm)
    .use(remarkDirective)
    .use(remarkPlainMarkdown);

  const tree = processor.runSync(processor.parse(source) as Root) as Root;

  const markdown = toMarkdown(tree, {
    extensions: [gfmToMarkdown(), mdxToMarkdown()],
    handlers: {
      mdxJsxFlowElement(node, parent, state, info) {
        const name = typeof node.name === 'string' ? node.name : '';
        if (LAYOUT_WRAPPERS.has(name)) {
          if (node.children.length === 0) return '';
          return state.containerFlow(node, info);
        }
        return mdxFlowHandler(node, parent, state, info);
      },
      mdxJsxTextElement(node, parent, state, info) {
        const name = typeof node.name === 'string' ? node.name : '';
        if (LAYOUT_WRAPPERS.has(name)) {
          if (node.children.length === 0) return '';
          return state.containerPhrasing(node, info);
        }
        return mdxTextHandler(node, parent, state, info);
      },
    },
  });

  return markdown.trim().replace(/\n{3,}/g, '\n\n') + '\n';
}

// ── buildMarkdownPage ────────────────────────────────────────────────────────

export interface BuildMarkdownPageOptions {
  /**
   * The app's API Reference tab slug, e.g. "api-reference", used to resolve
   * `<apiBase>/operations/<operationId>` URLs. Callers compute this from
   * their own docs.json (see each app's `lib/route.ts` `apiBasePath`) — same
   * convention as `ai/ask.ts` and `llms-txt.ts`; the framework stays decoupled
   * from any one app's routing. Defaults to "api-reference".
   */
  apiBasePath?: string;
}

function composePage(title: string, url: string, description: string | null, content: string): string {
  const parts = [`# ${title}`, '', `URL: ${url}`];
  if (description) parts.push('', description);
  parts.push('', content.trim());
  return parts.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

/**
 * Resolve a slug to the Markdown for one page. Order of resolution:
 * API operation → blog post → changelog entry → doc page (the docs nav owns
 * every other slug; the index page is the empty string). Returns null when
 * the slug matches nothing.
 */
export async function buildMarkdownPage(
  slug: string,
  options: BuildMarkdownPageOptions = {},
): Promise<string | null> {
  const config = loadDocsConfig();
  if (!config) return null;

  const apiBase = (options.apiBasePath ?? 'api-reference').replace(/^\/+|\/+$/g, '');
  // Next.js serves /index as an alias of the root page; resolve it to the
  // index slug here so /index.md maps to the index page.
  const normalizedSlug = slug === 'index' ? '' : slug;
  const segments = normalizedSlug.split('/').filter(Boolean);

  // API operation — <apiBase>/operations/<operationId>.
  if (segments[0] === apiBase && segments[1] === 'operations' && segments.length >= 3) {
    const operationId = segments.slice(2).join('/');
    const document = await loadApiDocument();
    if (!document) return null;
    const markdown = renderOperationMarkdown(document, { operationId });
    if (!markdown) return null;
    const info = document.info as { title?: unknown } | undefined;
    const title = typeof info?.title === 'string' ? info.title : 'API Reference';
    return composePage(title, `/${apiBase}/operations/${operationId}`, null, markdown);
  }

  // Blog post — blog/<postSlug>.
  if (segments[0] === 'blog' && segments.length === 2) {
    const post = loadBlogPost(segments[1]);
    if (!post) return null;
    return composePage(post.title, `/blog/${post.slug}`, post.description, processMarkdown(post.content));
  }

  // Changelog entry — changelog/<slug> (entries render on the single /changelog page).
  if (segments[0] === 'changelog' && segments.length === 2) {
    const entry = loadChangelogEntries().find((e) => e.slug === segments[1]);
    if (!entry) return null;
    return composePage(entry.title, `/changelog/${entry.slug}`, entry.version, processMarkdown(entry.content));
  }

  // Doc page — the docs nav owns every other slug ('' = index).
  const page = findDocPage(config, normalizedSlug);
  if (!page) return null;
  const loaded = loadDocPage(page.file);
  if (!loaded) return null;
  const description = typeof loaded.data.description === 'string' ? loaded.data.description : null;
  return composePage(page.title, `/${normalizedSlug}`, description, processMarkdown(loaded.content));
}

// ── createMarkdownHandler ────────────────────────────────────────────────────

export interface CreateMarkdownHandlerOptions extends BuildMarkdownPageOptions {}

/**
 * Creates a Next.js route-handler-shaped function. Uses Next's own
 * `[[...slug]]` params — the same mechanism Next uses to route pages — rather
 * than parsing the URL, so the markdown endpoint and the docs page agree on
 * which "file" a path resolves to.
 *
 * ```ts
 * // app/[[...slug]].md/route.ts
 * import { createMarkdownHandler } from '@inkform/framework/markdown';
 * import { apiBasePath, loadDocsConfig } from '@/lib/route';
 *
 * export const runtime = 'nodejs';
 * export const GET = createMarkdownHandler({
 *   apiBasePath: (() => {
 *     const config = loadDocsConfig();
 *     return config && apiBasePath(config) ? apiBasePath(config) : undefined;
 *   })(),
 * });
 * ```
 *
 * Mounted at `app/[[...slug]].md/route.ts`, the URL is `/quickstart.md`,
 * `/index.md`, `/concepts/pagination.md`, etc. — the page's own URL with a
 * `.md` extension, resolved through the same `[[...slug]]` params the docs
 * page uses. Unknown pages return a plain 404.
 */
export function createMarkdownHandler(options: CreateMarkdownHandlerOptions = {}) {
  return async (
    _request: Request,
    context: { params: Promise<{ slug?: string[] }> },
  ): Promise<Response> => {
    const { slug = [] } = await context.params;
    const markdown = await buildMarkdownPage(slug.join('/'), options);
    if (markdown === null) return new Response('Not Found', { status: 404 });
    return new Response(markdown, {
      headers: { 'content-type': 'text/markdown; charset=utf-8' },
    });
  };
}
