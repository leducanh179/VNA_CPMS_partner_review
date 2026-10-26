import { describe, expect, it, vi } from 'vitest';
import { OpenAiLookupAdapter } from './openai-lookup.adapter';
import { libraryModelItems } from '../domain/library-index';
import { DEFAULT_AI_POLICY, policyInstructions } from '../domain/workspace-policy';
import { addUsage, billingPeriod, costVnd, EMPTY_USAGE, MAX_MODEL_CALLS, MAX_OUTPUT_TOKENS, MAX_REQUEST_BYTES, normalizeSearch, TURN_RESERVATION_VND } from '../domain/lookup-policy';

const result = { content: { items: [{ name: 'Synthetic only' }] }, sources: [] };
function response(output: unknown[], status = 'completed') {
  return new Response(JSON.stringify({ status, output, usage: { input_tokens: 100, output_tokens: 50, input_tokens_details: { cached_tokens: 20 } } }));
}
const call = { type: 'function_call', name: 'search_materials', call_id: 'call-test', arguments: '{"query":"","campaignId":null}' };
const answer = { type: 'message', content: [{ type: 'output_text', text: 'Synthetic answer' }] };
function input() {
  return { question: 'Tìm tư liệu', previous: [], signal: new AbortController().signal, execute: vi.fn(async () => result), onUsage: vi.fn() };
}
describe('OpenAI lookup bounds and accounting', () => {
  it('fits repeated library searches and removes old chat before the latest exact-link result', async () => {
    const items = libraryModelItems(Array.from({length:5},(_,i)=>({id:`fake-${i}`,itemId:`fake-${i}`,rootId:'fake-root',name:`Tư liệu ${i} `+'Việt Nam '.repeat(60),
      href:`https://drive.google.com/file/d/fake-${i}/view`,format:'MP4',path:'Đường dẫn '.repeat(100),description:'Mô tả '.repeat(200),rights:'Chưa có thông tin',rightsNote:'Ghi chú '.repeat(100),sourceUpdatedAt:'2026-10-25',contentRead:false,matchedTerms:[]})));
    const send=vi.fn<typeof fetch>();
    for(let i=0;i<3;i++) send.mockResolvedValueOnce(response([{...call,name:'search_library',call_id:`call-${i}`,arguments:JSON.stringify({query:`query-${i}`,mediaType:'VIDEO'})}]));
    send.mockResolvedValueOnce(response([answer]));
    const request={...input(),previous:[{role:'user' as const,content:'Earlier chat '.repeat(500)},{role:'assistant' as const,content:'Earlier answer '.repeat(500)}],
      instructions:policyInstructions({...DEFAULT_AI_POLICY,instructions:'Quy tắc '.repeat(50)},1,2),execute:vi.fn(async()=>({content:{items},sources:[]}))};
    await new OpenAiLookupAdapter('test-only',send).answer(request);
    for(const [,init] of send.mock.calls) expect(Buffer.byteLength(String(init!.body))).toBeLessThanOrEqual(MAX_REQUEST_BYTES);
    const final=JSON.parse(String(send.mock.calls[3]![1]!.body));
    const outputs=final.input.filter((item:{type?:string})=>item.type==='function_call_output');
    expect(outputs).toHaveLength(3);
    expect(JSON.parse(outputs[2].output).content.items).toEqual(items);
    expect(outputs[0].output).not.toContain('drive.google.com');
  });
  it('finishes search/read/proposal chains with a bounded answer-only fourth call', async () => {
    const send = vi.fn<typeof fetch>();
    for (const name of ['search_campaigns','get_campaign','prepare_campaign_update']) send.mockResolvedValueOnce(response([{ ...call, name }]));
    send.mockResolvedValueOnce(response([answer]));
    const request = input();
    const result = await new OpenAiLookupAdapter('test-only',send).answer(request);
    expect(result.answer).toBe('Synthetic answer');
    expect(request.execute).toHaveBeenCalledTimes(3);
    expect(request.onUsage).toHaveBeenCalledTimes(4);
    expect(JSON.parse(String(send.mock.calls[3]![1]!.body)).tool_choice).toBe('none');
    expect(TURN_RESERVATION_VND).toBeGreaterThanOrEqual(costVnd({ inputTokens: MAX_MODEL_CALLS * MAX_REQUEST_BYTES, outputTokens: MAX_MODEL_CALLS * MAX_OUTPUT_TOKENS, cachedTokens: 0 }));
  });
  it('does not execute a tool if the provider violates the final answer-only round', async () => {
    const send = vi.fn<typeof fetch>().mockImplementation(async () => response([call]));
    const request = input();
    await expect(new OpenAiLookupAdapter('test-only',send).answer(request)).rejects.toMatchObject({ reason:'ROUND_LIMIT' });
    expect(send).toHaveBeenCalledTimes(MAX_MODEL_CALLS);
    expect(request.execute).toHaveBeenCalledTimes(MAX_MODEL_CALLS-1);
  });
  it('allows the model to select scoped CPMS tools, disables storage and accounts for every round', async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValueOnce(response([call])).mockResolvedValueOnce(response([answer]));
    const request = input();
    const value = await new OpenAiLookupAdapter('test-only', send).answer(request);
    expect(value.answer).toBe('Synthetic answer');
    expect(value.usage).toEqual({ inputTokens: 200, outputTokens: 100, cachedTokens: 40 });
    expect(request.onUsage).toHaveBeenCalledTimes(2);
    const body = JSON.parse(String(send.mock.calls[0]![1]!.body));
    expect(body.store).toBe(false); expect(body.tool_choice).toBe('auto');
    expect(body.tools.every((tool: {type: string}) => tool.type === 'function')).toBe(true);
    expect(request.execute).toHaveBeenCalledWith('search_materials', { query: '', campaignId: null });
  });
  it('accepts editing or ordinary conversation without a CPMS lookup and charges that model call', async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(response([answer]));
    const request = { ...input(), question: 'Viết lại lời mời: Mời các bạn dự buổi chia sẻ sách vào sáng Chủ nhật.' };
    const value = await new OpenAiLookupAdapter('test-only', send).answer(request);
    expect(value.answer).toBe('Synthetic answer');
    expect(request.execute).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledOnce();
    expect(request.onUsage).toHaveBeenCalledWith(value.usage);
    expect(value.usage.inputTokens).toBe(100);
  });
  it('keeps pasted source text when oversized older drafts must be omitted', async () => {
    const source = 'Nội dung gốc do người dùng gửi: ' + 'buổi chia sẻ sách '.repeat(70);
    const send = vi.fn<typeof fetch>().mockResolvedValue(response([answer]));
    await new OpenAiLookupAdapter('test-only', send).answer({ ...input(), question: 'Cứ làm đi', previous: [
      { role: 'user', content: source }, { role: 'assistant', content: 'draft'.repeat(MAX_REQUEST_BYTES) },
      { role: 'user', content: 'Viết thành lời mời ngắn' }, { role: 'assistant', content: 'Tôi sẽ viết lại.' },
    ] });
    const body = String(send.mock.calls[0]![1]!.body), payload = JSON.parse(body);
    expect(Buffer.byteLength(body)).toBeLessThanOrEqual(MAX_REQUEST_BYTES);
    expect(payload.input).toContainEqual({ role: 'user', content: source });
    expect(payload.input.at(-1)).toEqual({ role: 'user', content: 'Cứ làm đi' });
    expect(body).not.toContain('draft'.repeat(MAX_REQUEST_BYTES));
  });
  it('rejects empty responses and unknown write tools without executing them', async () => {
    for (const output of [[], [{ ...call, name: 'delete_campaign' }]]) {
      const request = input(), send = vi.fn<typeof fetch>().mockResolvedValue(response(output));
      await expect(new OpenAiLookupAdapter('test-only', send).answer(request)).rejects.toMatchObject({ uncertain: false });
      expect(request.execute).not.toHaveBeenCalled();
    }
  });
  it('does not retry transport errors and distinguishes definite rejection from unknown billing', async () => {
    for (const status of [401, 429, 500]) {
      const send = vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status }));
      await expect(new OpenAiLookupAdapter('test-only', send).answer(input())).rejects.toMatchObject({ uncertain: status === 500 });
      expect(send).toHaveBeenCalledTimes(1);
    }
    const send = vi.fn<typeof fetch>().mockRejectedValue(new Error('connection lost'));
    await expect(new OpenAiLookupAdapter('test-only', send).answer(input())).rejects.toMatchObject({ uncertain: true });
  });
  it('rejects oversized context before spending and accounts for incomplete answers', async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(response([], 'incomplete'));
    await expect(new OpenAiLookupAdapter('test-only', send).answer({ ...input(), question: 'a'.repeat(MAX_REQUEST_BYTES) })).rejects.toMatchObject({ uncertain: false });
    expect(send).not.toHaveBeenCalled();
    const request = input();
    await expect(new OpenAiLookupAdapter('test-only', send).answer(request)).rejects.toMatchObject({ uncertain: false });
    expect(request.onUsage).toHaveBeenCalledOnce();
  });
  it('rolls over by Vietnam calendar and reserves above the cost of bounded requests', () => {
    expect(billingPeriod(new Date('2026-10-31T16:59:59Z'))).toBe('2026-10');
    expect(billingPeriod(new Date('2026-10-31T17:00:00Z'))).toBe('2026-11');
    const usage = EMPTY_USAGE();
    addUsage(usage, { inputTokens: 100, cachedTokens: 0, outputTokens: 50 });
    expect(costVnd(usage)).toBeGreaterThan(0);
    expect(TURN_RESERVATION_VND).toBeGreaterThan(costVnd(usage));
    expect(normalizeSearch('Đường bay TẾT')).toBe('duong bay tet');
  });
});
