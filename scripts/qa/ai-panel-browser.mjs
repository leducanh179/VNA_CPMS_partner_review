import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { resolve, extname, sep } from 'node:path';
import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { createServer } from 'node:http';
const require = createRequire(import.meta.url);
const { build } = await import(pathToFileURL(require.resolve('vite', {paths:[resolve('apps/web')]})).href);
const tailwind = require(require.resolve('tailwindcss', {paths:[resolve('apps/web')]}));
const loadConfig = require(require.resolve('tailwindcss/loadConfig', {paths:[resolve('apps/web')]}));
const css = loadConfig(resolve('apps/web/tailwind.config.ts'));
css.content = [resolve('apps/web/src/**/*.{ts,tsx}'),resolve('packages/ui/src/**/*.{ts,tsx}'),resolve('scripts/qa/ai-panel-fixture.tsx')];
const { chromium } = await import(pathToFileURL(process.env.CPMS_PLAYWRIGHT_PATH).href);
const out = resolve('private-local/ai-expansion-20261025/browser');
await mkdir(out,{recursive:true});
const html = resolve('apps/web/ai-panel-qa.html'), entry = resolve('apps/web/ai-panel-qa.tsx');
const checks = [], errors = [], asks = [], contexts = [], chats = new Map();
const check = message => {checks.push(message);console.log('PASS',message);};
let browser, server, hold = null, meId = 'qa-actor';
let confirms=0,proposalState='PREPARED';
const policy={agentEnabled:true,libraryEnabled:false,spreadsheetId:'',allowedRootIds:[],maxQuestions:2,maxResults:5,includeUnknownRights:true,answerFormat:'CARDS',instructions:'',selectionRules:'Ưu tiên ảnh chính thức',vision:{enabled:false,maxImagesPerRequest:10,monthlyLimitVnd:0}};
let settings={version:1,draftVersion:1,published:{...policy},draft:{...policy},versions:[],library:{version:0,syncedAt:null,count:0,spreadsheetId:''}};
const proposal=()=>({id:'qa-proposal',campaignId:'00000000-0000-4000-8000-000000000001',title:'Mở bán vé Tết mẫu',expectedVersion:1,changes:[{field:'name',label:'Tên chiến dịch',before:'Tên cũ',after:'Tên mới từ AI'}],reason:'Nội dung người dùng cung cấp',state:proposalState,createdAt:new Date().toISOString(),canSubmit:true,submission:'Gửi Ban TT phê duyệt',result:proposalState==='PREPARED'?null:{message:'Đã lưu và gửi theo quy trình.'}});
const me = () => ({account:{id:meId,displayName:'QA Actor',roles:[],accountKind:'PERSONNEL',recordVersion:1,mustChangePassword:false,profile:{}},originalActor:{id:meId,displayName:'QA Actor'},mode:'DIRECT',directSuperadmin:meId==='qa-actor',expiresAt:new Date(Date.now()+3600000).toISOString(),mustChangePassword:false,scopedBoundaryReady:true});
try {
  await writeFile(entry,(await readFile('scripts/qa/ai-panel-fixture.tsx','utf8')).replaceAll('../../apps/web/','./'));
  await writeFile(html,'<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="icon" href="data:,"></head><body><div id="root"></div><script type="module" src="/ai-panel-qa.tsx"></script></body></html>');
  await build({root:resolve('apps/web'),configFile:resolve('apps/web/vite.config.ts'),css:{postcss:{plugins:[tailwind(css)]}},build:{outDir:out+'/dist',emptyOutDir:true,rollupOptions:{input:html}}});
  server=createServer(async(req,res)=>{
    const url=new URL(req.url,'http://localhost');
    if(url.pathname.startsWith('/api/')){
      let raw='';for await(const chunk of req)raw+=chunk;const body=raw?JSON.parse(raw):null;
      res.setHeader('content-type','application/json');const send=value=>res.end(JSON.stringify(value));
      if(url.pathname==='/api/auth/me')return send(me());
      if(url.pathname==='/api/access/capabilities')return send({policyVersion:1,permissions:{'campaign.read':true,'contract.read':true,'booking.read':true}});
      if(url.pathname==='/api/ai/lookup/status')return send({allowed:meId==='qa-actor',ready:true,mode:'MOCK',period:'2026-10',chargedVnd:0,reservedVnd:0,limitVnd:100000});
      if(url.pathname==='/api/ai/workspace/settings')return send(settings);
      if(url.pathname==='/api/ai/workspace/settings/draft'){settings={...settings,draft:body.policy,draftVersion:settings.draftVersion+1};return send(settings);}
      if(url.pathname==='/api/ai/workspace/settings/publish'){settings={...settings,published:settings.draft,version:settings.version+1,draftVersion:settings.draftVersion+1};return send(settings);}
      if(url.pathname==='/api/ai/workspace/proposals/qa-proposal')return send(proposal());
      if(url.pathname==='/api/ai/workspace/proposals/qa-proposal/confirm'){assert.equal(body.confirmed,true);confirms++;proposalState='SUBMITTED';return send(proposal());}
      if(url.pathname==='/api/ai/lookup/context'){
        contexts.push(body);return send({title:body.type==='CELL'?body.label:'Mở bán vé Tết mẫu',text:body.type==='CELL'?body.text:'Hồ sơ đã lưu: Mở bán vé Tết mẫu; thời gian 01–31/12.',truncated:false,sources:[]});
      }
      if(url.pathname==='/api/ai/lookup/ask'){
        asks.push(body);if(hold)await hold;
        const id=body.conversationId||crypto.randomUUID(), current=chats.get(id)||{conversation:{id,title:body.question,version:1,updatedAt:new Date().toISOString()},items:[],nextCursor:null};
        const answer={id:body.id,conversationId:id,question:body.question,answer:'Bản biên tập mẫu đã hoàn tất.',state:'COMPLETE',mode:'MOCK',estimatedCostVnd:0,createdAt:new Date().toISOString(),sources:[{kind:'CAMPAIGN',id:'qa-source',title:'Nguồn mẫu',href:'/campaigns/qa-source',version:1}]};
        if(body.question==='Nhập liệu theo mẫu')answer.artifacts={proposalId:'qa-proposal',questions:[{question:'Tư liệu cho kênh nào?',options:['Web','In ấn']}],library:[{id:'sample-library',itemId:'synthetic',name:'Ảnh Đà Nẵng mẫu',href:'https://drive.google.com/file/d/synthetic/view',path:'Đà Nẵng',format:'JPG',rights:'Chưa có thông tin',rightsNote:'',sourceUpdatedAt:'21/08/2026',matchedTerms:['Đà Nẵng'],contentRead:false}],librarySyncedAt:new Date().toISOString()};
        current.items.push(answer);chats.set(id,current);return send(answer);
      }
      if(url.pathname==='/api/ai/lookup/conversations')return send({items:meId==='qa-actor'?[...chats.values()].map(row=>row.conversation):[],nextCursor:null});
      if(url.pathname.startsWith('/api/ai/lookup/conversations/')){
        const id=url.pathname.split('/').at(-1), row=chats.get(id);
        if(req.method==='PATCH'){row.conversation.title=body.title;row.conversation.version++;return send(row.conversation);}
        if(req.method==='DELETE'){chats.delete(id);return send({deleted:true});}
        return send(row);
      }
      if(url.pathname.endsWith('/inbox'))return send(url.pathname.includes('/contracts/')?[]:{items:[]});
      return send([]);
    }
    try {const file=extname(url.pathname)?resolve(out+'/dist','.'+url.pathname):resolve(out,'dist/ai-panel-qa.html');if(!file.startsWith(out+sep))throw Error('path');res.setHeader('content-type',({'.js':'text/javascript','.css':'text/css','.html':'text/html','.png':'image/png'})[extname(file)]||'application/octet-stream');res.end(await readFile(file));}catch{res.statusCode=404;res.end();}
  });
  await new Promise(done=>server.listen(0,'127.0.0.1',done));const origin=`http://127.0.0.1:${server.address().port}`;
  browser=await chromium.launch({channel:'msedge',headless:true});
  const context=await browser.newContext({viewport:{width:1440,height:1000},permissions:['clipboard-read','clipboard-write']});
  await context.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():route.abort());
  const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(15000);
  await page.goto(origin+'/campaigns?filter=kept');
  const form=page.getByLabel('Nội dung nghiệp vụ chưa lưu');await form.fill('Nội dung chưa lưu phải còn nguyên.');
  await page.locator('[data-field-key=name]').click();
  await page.getByRole('button',{name:'Mở rộng bảng',exact:true}).click();
  await page.getByRole('button',{name:'Mở Trợ lý AI',exact:true}).click();
  const panel=page.getByRole('region',{name:'Trợ lý AI bên cạnh',exact:true});await panel.waitFor();
  await page.getByText('Hồ sơ đã lưu: Mở bán vé Tết mẫu',{exact:true}).waitFor();assert.equal(contexts.at(-1).type,'RECORD');
  check('Opening the small panel automatically attaches the selected whole record');
  await page.getByRole('button',{name:'Thu gọn',exact:true}).click();
  assert.equal(await form.inputValue(),'Nội dung chưa lưu phải còn nguyên.');assert.equal(new URL(page.url()).search,'?filter=kept');
  await page.getByRole('button',{name:'Dùng ô đang chọn',exact:true}).click();await page.getByText('Nội dung ô: Tên hồ sơ',{exact:true}).waitFor();assert.equal(contexts.at(-1).text,'Mở bán vé Tết mẫu');
  for(const kind of ['CAMPAIGN','MATERIAL','CONTRACT','BOOKING']){
    await page.getByLabel('Phân hệ thử nghiệm').selectOption(kind);await page.locator('[data-field-key=name]').click();
    await page.getByRole('button',{name:'Cả hồ sơ (mặc định)',exact:true}).click();await page.getByText('Hồ sơ đã lưu: Mở bán vé Tết mẫu',{exact:true}).waitFor();
    assert.equal(contexts.at(-1).record.kind,kind);assert.equal(Object.keys(contexts.at(-1).record).sort().join(','),'id,kind');
  }
  check('Cell versus whole-record context for all four kinds; sends references rather than client record snapshots');
  await page.getByRole('button',{name:'Bỏ ngữ cảnh đính kèm'}).click();
  await page.getByRole('button',{name:'Cả hồ sơ (mặc định)',exact:true}).click();await page.getByText('Hồ sơ đã lưu: Mở bán vé Tết mẫu',{exact:true}).waitFor();
  await page.getByLabel('Câu hỏi cho Trợ lý AI').fill('Biên tập lời giới thiệu mẫu.');
  await page.getByRole('button',{name:'Mở rộng Trợ lý AI'}).click();assert.equal(await form.inputValue(),'Nội dung chưa lưu phải còn nguyên.');
  await page.getByRole('button',{name:'Thu về bảng bên phải'}).click();
  const divider=page.getByRole('separator',{name:'Điều chỉnh chiều rộng Trợ lý AI'});await divider.press('ArrowLeft');assert.equal(await divider.getAttribute('aria-valuenow'),'464');
  let release;hold=new Promise(done=>{release=done;});
  await page.getByRole('button',{name:'Gửi',exact:true}).click();await page.getByText('Đang xử lý yêu cầu của bạn…',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Thu nhỏ Trợ lý AI'}).click();
  await form.fill('Tiếp tục nhập trong khi AI đang trả lời.');release();hold=null;
  await page.getByText('Có trả lời mới',{exact:true}).waitFor();await page.getByRole('button',{name:'Mở Trợ lý AI',exact:true}).click();
  await page.getByText('Bản biên tập mẫu đã hoàn tất.',{exact:true}).waitFor();
  assert.equal(asks.length,1);assert.deepEqual(asks[0].context,{type:'RECORD',record:{kind:'BOOKING',id:'00000000-0000-4000-8000-000000000001'}});assert.equal(await form.inputValue(),'Tiếp tục nhập trong khi AI đang trả lời.');assert.equal(new URL(page.url()).search,'?filter=kept');
  await page.getByRole('button',{name:'Sao chép',exact:true}).click();assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),'Bản biên tập mẫu đã hoàn tất.');
  assert.equal(await page.getByRole('link',{name:'Nguồn mẫu'}).getAttribute('target'),'_blank');
  await page.screenshot({path:out+'/panel-desktop.png'});
  check('Business draft/URL retained through resize, expand, minimize and background completion; copy works; source opens a new tab');
  await page.getByLabel('Câu hỏi cho Trợ lý AI').fill('Bản câu hỏi chưa gửi.');
  await page.getByRole('link',{name:'Tư liệu',exact:true}).click();assert.equal(await page.getByLabel('Câu hỏi cho Trợ lý AI').inputValue(),'Bản câu hỏi chưa gửi.');
  await page.getByRole('link',{name:'Trợ lý AI',exact:true}).click();await page.waitForURL('**/?chat=*');const chatUrl=page.url();
  assert.equal(await page.getByLabel('Câu hỏi cho Trợ lý AI').inputValue(),'Bản câu hỏi chưa gửi.');
  await page.reload();await page.getByText('Bản biên tập mẫu đã hoàn tất.',{exact:true}).waitFor();assert.equal(page.url(),chatUrl);
  await page.getByRole('button',{name:'Đổi tên Biên tập lời giới thiệu mẫu.',exact:true}).click();await page.getByLabel('Tên hội thoại').fill('Hội thoại đã đổi tên');await page.getByRole('button',{name:'Lưu tên',exact:true}).click();
  await page.getByRole('heading',{name:'Hội thoại đã đổi tên',exact:true}).waitFor();
  await page.getByRole('link',{name:'Chiến dịch',exact:true}).click();await page.getByRole('button',{name:'Mở Trợ lý AI',exact:true}).click();
  await page.getByRole('heading',{name:'Hội thoại đã đổi tên',exact:true}).waitFor();
  check('One history and unsent question across module/home navigation; reload and rename persist');
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:out+'/panel-mobile.png'});
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.getByRole('button',{name:'Thu nhỏ Trợ lý AI'}).click();await page.getByRole('button',{name:'Mở Trợ lý AI',exact:true}).click();
  await page.getByRole('button',{name:'Lịch sử',exact:true}).click();page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'Xóa Hội thoại đã đổi tên',exact:true}).click();
  await page.getByRole('heading',{name:'Hôm nay, bạn cần hỗ trợ gì?'}).waitFor();assert.equal(chats.size,0);
  check('Mobile fits viewport; saved conversation deletion is confirmed and reflected in shared history');
  await page.setViewportSize({width:1440,height:1000});
  await page.getByLabel('Phân hệ thử nghiệm').selectOption('CAMPAIGN');await page.locator('[data-field-key=name]').click();
  await page.getByText('Hồ sơ đã lưu: Mở bán vé Tết mẫu',{exact:true}).waitFor();
  await page.getByLabel('Câu hỏi cho Trợ lý AI').fill('Nhập liệu theo mẫu');await page.getByRole('button',{name:'Gửi',exact:true}).click();
  await page.getByRole('region',{name:'Đề xuất nhập liệu',exact:true}).waitFor();
  await page.getByLabel('Đánh dấu form chưa lưu').check();await page.getByRole('button',{name:'Lưu và gửi duyệt',exact:true}).click();
  await page.getByText('Màn hình nghiệp vụ đang có nội dung chưa lưu.',{exact:false}).waitFor();assert.equal(confirms,0);
  await page.getByLabel('Đánh dấu form chưa lưu').uncheck();await page.getByRole('button',{name:'Lưu và gửi duyệt',exact:true}).click();
  await page.getByText('Đã lưu và gửi theo quy trình.',{exact:true}).waitFor();assert.equal(confirms,1);
  assert.equal(await page.getByRole('link',{name:'Ảnh Đà Nẵng mẫu',exact:true}).getAttribute('href'),'https://drive.google.com/file/d/synthetic/view');
  await page.getByRole('button',{name:'Web',exact:true}).click();assert((await page.getByLabel('Câu hỏi cho Trợ lý AI').inputValue()).includes('Web'));
  await page.screenshot({path:out+'/proposal-library.png'});
  check('Proposal preview requires explicit confirmation; unsaved form blocks submission; exact library links and clarification choices rendered');
  await page.goto(origin+'/admin/system');await page.getByRole('heading',{name:'Thiết lập Trợ lý AI',exact:true}).waitFor();
  await page.getByLabel('Hướng dẫn của quản trị viên và cách trả lời').fill('Trả lời ngắn, dùng link gốc.');
  assert(await page.getByRole('button',{name:'Phát hành cấu hình',exact:true}).isDisabled());
  await page.getByRole('button',{name:'Lưu bản nháp',exact:true}).click();await page.getByRole('button',{name:'Phát hành cấu hình',exact:true}).click();
  await page.getByText('Đang áp dụng: phiên bản 2',{exact:false}).waitFor();assert.equal(settings.published.instructions,'Trả lời ngắn, dùng link gốc.');
  await page.screenshot({path:out+'/settings.png'});
  check('Admin draft is saved before publishing; published version and instructions persist');
  await page.goto(origin+'/campaigns');await page.getByRole('button',{name:'Mở Trợ lý AI',exact:true}).click();
  await page.getByLabel('Câu hỏi cho Trợ lý AI').fill('Private draft sentinel');meId='qa-other';await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await page.getByRole('button',{name:'Mở Trợ lý AI',exact:true}).waitFor();await page.getByRole('button',{name:'Mở Trợ lý AI',exact:true}).click();
  assert.equal(await page.getByLabel('Câu hỏi cho Trợ lý AI').inputValue(),'');assert(await page.getByRole('button',{name:'Gửi',exact:true}).isDisabled());
  check('Identity change clears chat draft and selection; non-pilot cannot send');
  assert.deepEqual(errors,[]);await writeFile(out+'/result.json',JSON.stringify({checks,errors,externalRequestsAllowed:false,productionTouched:false},null,2));
} finally {await browser?.close();if(server)await new Promise(done=>server.close(done));await unlink(html).catch(()=>{});await unlink(entry).catch(()=>{});}
