import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AiMessage, safeAiHref } from './ai-message';

const render = (text: string) => renderToStaticMarkup(createElement(AiMessage, { text }));

describe('AI answer Markdown', () => {
  it('renders saved Markdown as emphasis, nested lists, quotes, tables and code', () => {
    const html = render('## Tư liệu phù hợp\n\n**Nội dung đậm** và *nghiêng*.\n\n1. Phim\n   - Bản 30 giây\n\n> Nguồn cung cấp\n\n| Tên | Loại |\n| --- | --- |\n| Mẫu | MP4 |\n\n`mã`\n\n```html\n<script>alert(1)</script>\n```');
    expect(html).toContain('<strong>Nội dung đậm</strong>');
    expect(html).toContain('<em>nghiêng</em>');
    for (const tag of ['ol', 'ul', 'blockquote', 'table', 'thead', 'tbody', 'pre', 'code']) expect(html).toContain(`<${tag}`);
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script');
  });
  it('makes named links and bare URLs clickable without changing the exact destination', () => {
    const href = 'https://drive.google.com/file/d/synthetic/view?usp=sharing&x=1';
    const html = render(`[Mở tư liệu](${href})\n\nhttps://example.com/guide\n\n[Hồ sơ](/campaigns/synthetic)\n\n[Email](mailto:qa@example.com)`);
    expect(html).toContain(`href="${href.replace('&', '&amp;')}"`);
    expect(html).toContain('href="https://example.com/guide"');
    expect(html).toContain('href="/campaigns/synthetic"');
    expect(html).toContain('href="mailto:qa@example.com"');
    expect(html.match(/target="_blank" rel="noopener noreferrer"/g)).toHaveLength(4);
  });
  it('ignores raw HTML and rejects executable, credentialed and ambiguous URLs', () => {
    const html = render('<script>alert(1)</script>\n\n<img src="https://example.com/pixel" onerror="alert(1)">\n\n[Bad](javascript:alert%281%29)\n\n[Data](data:text/html,evil)\n\n[File](file:///etc/passwd)');
    expect(html).not.toMatch(/<(script|img|iframe|a)\b/);
    expect(html).not.toContain('onerror');
    for (const href of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'java\nscript:alert(1)', 'data:text/html,evil', '//example.com', '/\\example.com', 'https://user:password@example.com', 'vbscript:x', 'file:///a', 'relative/path']) expect(safeAiHref(href)).toBeUndefined();
  });
  it('renders Markdown images as links without loading external media', () => {
    const html = render('![Ảnh minh họa](https://example.com/pixel.png)');
    expect(html).toContain('href="https://example.com/pixel.png"');
    expect(html).toContain('Ảnh minh họa');
    expect(html).not.toMatch(/<(img|iframe|video|audio)\b/);
  });
  it('keeps ordinary text and incomplete Markdown readable', () => {
    expect(render('Nội dung thường.\nDòng thứ hai.')).toContain('Nội dung thường.\nDòng thứ hai.');
    expect(render('**Đang viết')).toContain('**Đang viết');
    expect(render('A < B & C')).toContain('A &lt; B &amp; C');
  });
});
