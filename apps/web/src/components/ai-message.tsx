import { memo, useId, type ReactNode } from 'react';
import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

/** AI text is untrusted. Allow navigation only, never executable or embedded content. */
export function safeAiHref(raw: string): string | undefined {
  const href = raw.trim();
  if (!href || [...href].some(char => char === '\\' || char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) return undefined;
  if (href.startsWith('#')) return href;
  if (href.startsWith('/') && !href.startsWith('//')) return href;
  try {
    const url = new URL(href);
    if (!['https:', 'http:', 'mailto:'].includes(url.protocol) || url.username || url.password) return undefined;
    return href;
  } catch { return undefined; }
}

function MessageLink({ href, title, children }: { href?: string | undefined; title?: string | undefined; children?: ReactNode }) {
  const safe = href && safeAiHref(href);
  if (!safe) return <span>{children}</span>;
  const localAnchor = safe.startsWith('#');
  return <a href={safe} title={title} target={localAnchor ? undefined : '_blank'}
    rel={localAnchor ? undefined : 'noopener noreferrer'}>{children}</a>;
}

const components: Components = {
  a: ({ href, title, children }) => <MessageLink href={href} title={title}>{children}</MessageLink>,
  // Keep remote images as explicit links: rendering an answer must not contact third-party hosts.
  img: ({ src, alt }) => <MessageLink href={typeof src === 'string' ? src : undefined}>Ảnh: {alt || 'Mở ảnh'}</MessageLink>,
  table: ({ children }) => <div className="cpms-ai-table-scroll" role="region" aria-label="Bảng trong câu trả lời AI" tabIndex={0}><table>{children}</table></div>,
  h1: 'h3', h2: 'h3', h3: 'h4', h4: 'h5', h5: 'h6', h6: 'h6',
};

/** Shared by the home workspace and dock; saved answers are formatted without another model call. */
export const AiMessage = memo(function AiMessage({ text }: { text: string }) {
  const prefix = `ai-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}-`;
  return <div className="cpms-ai-message">
    <Markdown remarkPlugins={[remarkGfm]} remarkRehypeOptions={{ clobberPrefix: prefix }} skipHtml
      urlTransform={safeAiHref} components={components}>{text}</Markdown>
  </div>;
});
