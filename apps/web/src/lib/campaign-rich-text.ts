import type { CampaignRichTextDocument, CampaignRichTextNode } from '@cpms/domain';

export const EMPTY_CAMPAIGN_RICH_TEXT: CampaignRichTextDocument = {
  schemaVersion: 1,
  type: 'doc',
  content: [{ type: 'paragraph', content: [] }],
};

export function isSafeHttpsUrl(value: string) {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

export function isRichTextEmpty(document: CampaignRichTextDocument | null) {
  if (!document) return true;
  let hasContent = false;
  const visit = (node: CampaignRichTextNode) => {
    if (node.type === 'image' || node.type === 'table') hasContent = true;
    if (node.type === 'text' && node.text?.trim()) hasContent = true;
    node.content?.forEach(visit);
  };
  document.content.forEach(visit);
  return !hasContent;
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function renderChildren(node: CampaignRichTextNode) {
  return (node.content ?? []).map(renderRichTextNode).join('');
}

function renderRichTextNode(node: CampaignRichTextNode): string {
  if (node.type === 'text') {
    let value = escapeHtml(node.text ?? '');
    for (const mark of node.marks ?? []) {
      if (mark.type === 'bold') value = `<strong>${value}</strong>`;
      if (mark.type === 'italic') value = `<em>${value}</em>`;
    }
    return value;
  }
  if (node.type === 'hardBreak') return '<br>';
  if (node.type === 'paragraph') return `<p>${renderChildren(node) || '<br>'}</p>`;
  if (node.type === 'bulletList') return `<ul>${renderChildren(node)}</ul>`;
  if (node.type === 'orderedList') return `<ol>${renderChildren(node)}</ol>`;
  if (node.type === 'listItem') return `<li>${renderChildren(node)}</li>`;
  if (node.type === 'table') return `<table><tbody>${renderChildren(node)}</tbody></table>`;
  if (node.type === 'tableRow') return `<tr>${renderChildren(node)}</tr>`;
  if (node.type === 'tableCell') return `<td>${renderChildren(node) || '<br>'}</td>`;
  if (node.type === 'link') {
    const href = node.attrs?.href ?? '';
    return isSafeHttpsUrl(href)
      ? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${renderChildren(node)}</a>`
      : renderChildren(node);
  }
  if (node.type === 'image') {
    const source = node.attrs?.src ?? '';
    if (!isSafeHttpsUrl(source)) return '';
    const alt = escapeHtml(node.attrs?.alt ?? 'Ảnh minh họa');
    return `<img src="${escapeHtml(source)}" alt="${alt}">`;
  }
  return renderChildren(node);
}

export function richTextToHtml(document: CampaignRichTextDocument | null) {
  return (document ?? EMPTY_CAMPAIGN_RICH_TEXT).content.map(renderRichTextNode).join('');
}
