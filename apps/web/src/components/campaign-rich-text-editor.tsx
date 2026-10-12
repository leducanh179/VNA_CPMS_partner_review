import type { CampaignRichTextDocument, CampaignRichTextMark, CampaignRichTextNode } from '@cpms/domain';
import { Button, CpmsIcon } from '@cpms/ui';
import { useEffect, useRef, useState } from 'react';
import { EMPTY_CAMPAIGN_RICH_TEXT, isSafeHttpsUrl, richTextToHtml } from '../lib/campaign-rich-text';

interface CampaignRichTextEditorProps {
  disabled?: boolean;
  value: CampaignRichTextDocument | null;
  onChange(value: CampaignRichTextDocument): void;
  onValidationError(message: string): void;
  label?: string;
  placeholder?: string;
  idPrefix?: string;
}

function uniqueMarks(marks: CampaignRichTextMark[]) {
  return marks.filter((mark, index) => marks.findIndex((candidate) => candidate.type === mark.type) === index);
}

function parseDomNode(node: Node, marks: CampaignRichTextMark[] = []): CampaignRichTextNode[] {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent ?? '';
    return text ? [{ type: 'text', text, ...(marks.length ? { marks: uniqueMarks(marks) } : {}) }] : [];
  }
  if (!(node instanceof HTMLElement)) return [];

  const tag = node.tagName.toLowerCase();
  const children = (nextMarks = marks) => Array.from(node.childNodes).flatMap((child) => parseDomNode(child, nextMarks));
  if (tag === 'strong' || tag === 'b') return children([...marks, { type: 'bold' }]);
  if (tag === 'em' || tag === 'i') return children([...marks, { type: 'italic' }]);
  if (tag === 'br') return [{ type: 'hardBreak' }];
  if (tag === 'p' || tag === 'div') return [{ type: 'paragraph', content: children() }];
  if (tag === 'ul') return [{ type: 'bulletList', content: children() }];
  if (tag === 'ol') return [{ type: 'orderedList', content: children() }];
  if (tag === 'li') return [{ type: 'listItem', content: children() }];
  if (tag === 'table') return [{ type: 'table', content: children() }];
  if (tag === 'tr') return [{ type: 'tableRow', content: children() }];
  if (tag === 'td' || tag === 'th') return [{ type: 'tableCell', content: children() }];
  if (tag === 'a') {
    const href = node.getAttribute('href') ?? '';
    return isSafeHttpsUrl(href) ? [{ type: 'link', attrs: { href }, content: children() }] : children();
  }
  if (tag === 'img') {
    const src = node.getAttribute('src') ?? '';
    return isSafeHttpsUrl(src) ? [{ type: 'image', attrs: { src, alt: node.getAttribute('alt') ?? '' } }] : [];
  }
  return children();
}

function editorDocument(root: HTMLElement): CampaignRichTextDocument {
  const content = Array.from(root.childNodes).flatMap((node) => parseDomNode(node));
  return { schemaVersion: 1, type: 'doc', content: content.length ? content : EMPTY_CAMPAIGN_RICH_TEXT.content };
}

export function CampaignRichTextEditor({ value, onChange, onValidationError, disabled = false, label = 'mô tả chiến dịch', placeholder = 'Nhập mô tả chiến dịch…', idPrefix = 'campaign' }: CampaignRichTextEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const lastEmitted = useRef('');
  const savedRange = useRef<Range | null>(null);
  const selectionWasCollapsed = useRef(true);
  const [insertMode, setInsertMode] = useState<'link' | 'image' | null>(null);
  const [urlInput, setUrlInput] = useState('');

  useEffect(() => {
    const next = JSON.stringify(value ?? EMPTY_CAMPAIGN_RICH_TEXT);
    if (!editorRef.current || next === lastEmitted.current) return;
    editorRef.current.innerHTML = richTextToHtml(value);
    lastEmitted.current = next;
  }, [value]);

  const emit = () => {
    if (!editorRef.current || disabled) return;
    const next = editorDocument(editorRef.current);
    lastEmitted.current = JSON.stringify(next);
    onChange(next);
  };

  const beginUrlInsert = (mode: 'link' | 'image') => {
    const selection = window.getSelection();
    savedRange.current = selection?.rangeCount ? selection.getRangeAt(0).cloneRange() : null;
    selectionWasCollapsed.current = selection?.isCollapsed ?? true;
    setInsertMode(mode);
    setUrlInput('');
  };

  const restoreSelection = () => {
    const selection = window.getSelection();
    editorRef.current?.focus();
    if (savedRange.current && selection) {
      selection.removeAllRanges();
      selection.addRange(savedRange.current);
    }
  };

  const run = (command: string, commandValue?: string) => {
    editorRef.current?.focus();
    document.execCommand(command, false, commandValue);
    emit();
  };

  const applyUrl = () => {
    const url = urlInput.trim();
    if (!url) return;
    if (!isSafeHttpsUrl(url)) {
      onValidationError(insertMode === 'image'
        ? 'Ảnh chỉ chấp nhận URL HTTPS; không nhận data URL hoặc file tải lên.'
        : 'Liên kết chỉ chấp nhận URL HTTPS an toàn.');
      return;
    }
    restoreSelection();
    if (insertMode === 'image') document.execCommand('insertImage', false, url);
    if (insertMode === 'link') {
      if (selectionWasCollapsed.current) {
        const escaped = url.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
        document.execCommand('insertHTML', false, `<a href="${escaped}">${escaped}</a>`);
      } else document.execCommand('createLink', false, url);
    }
    emit();
    setInsertMode(null);
    setUrlInput('');
  };

  const toolbar = [
    { name: 'paragraph' as const, label: 'Đoạn văn', action: () => run('formatBlock', 'p') },
    { name: 'bold' as const, label: 'In đậm', action: () => run('bold') },
    { name: 'italic' as const, label: 'In nghiêng', action: () => run('italic') },
    { name: 'bulletList' as const, label: 'Danh sách dấu đầu dòng', action: () => run('insertUnorderedList') },
    { name: 'numberedList' as const, label: 'Danh sách đánh số', action: () => run('insertOrderedList') },
    { name: 'link' as const, label: 'Chèn liên kết HTTPS', action: () => beginUrlInsert('link') },
    { name: 'image' as const, label: 'Chèn ảnh từ URL HTTPS', action: () => beginUrlInsert('image') },
    { name: 'table' as const, label: 'Chèn bảng 2 × 2', action: () => run('insertHTML', '<table><tbody><tr><td>Ô 1</td><td>Ô 2</td></tr><tr><td>Ô 3</td><td>Ô 4</td></tr></tbody></table><p><br></p>') },
  ];

  return (
    <div className="mt-2 overflow-hidden rounded-xl border border-slate-200 bg-white focus-within:border-vna-blue focus-within:ring-4 focus-within:ring-cyan-100">
      <div className="flex flex-wrap gap-1 border-b border-slate-200 bg-slate-50 px-2 py-2" role="toolbar" aria-label={`Định dạng ${label}`}>
        {toolbar.map((item) => (
          <button
            key={item.name}
            type="button"
            disabled={disabled}
            className="grid size-9 place-items-center rounded-lg text-slate-600 transition hover:bg-white hover:text-vna-blue"
            aria-label={item.label}
            title={item.label}
            onMouseDown={(event) => event.preventDefault()}
            onClick={item.action}
          >
            <CpmsIcon name={item.name} />
          </button>
        ))}
      </div>
      {insertMode ? <div className="flex flex-wrap items-end gap-2 border-b border-slate-200 bg-cyan-50/50 px-3 py-3"><label className="min-w-64 flex-1 text-xs font-semibold text-slate-700" htmlFor={`${idPrefix}-rich-url`}>URL HTTPS {insertMode === 'image' ? 'của ảnh' : 'liên kết'}<input id={`${idPrefix}-rich-url`} autoFocus className="mt-1.5 min-h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-normal outline-none focus:border-vna-blue" value={urlInput} onChange={(event) => setUrlInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); applyUrl(); } }} placeholder="https://example.com/..." /></label><Button size="sm" onClick={applyUrl}>Chèn {insertMode === 'image' ? 'ảnh' : 'liên kết'}</Button><Button size="sm" variant="ghost" onClick={() => { setInsertMode(null); setUrlInput(''); }}>Hủy</Button></div> : null}
      <div
        ref={editorRef}
        contentEditable={!disabled}
        role="textbox"
        aria-label={label}
        aria-readonly={disabled}
        suppressContentEditableWarning
        className="campaign-rich-editor min-h-48 px-4 py-3 text-sm leading-7 text-slate-800 outline-none"
        data-placeholder={placeholder}
        onInput={emit}
      />
      <p className="border-t border-slate-100 px-3 py-2 text-xs text-slate-500">Ảnh và liên kết chỉ nhận URL HTTPS. Không tải file, ảnh hoặc data URL vào CPMS.</p>
    </div>
  );
}
