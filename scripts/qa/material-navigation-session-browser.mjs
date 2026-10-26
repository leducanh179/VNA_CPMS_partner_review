import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { resolve, extname } from 'node:path';
import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { createServer } from 'node:http';
const require = createRequire(import.meta.url);
const { build } = await import(pathToFileURL(require.resolve('vite', { paths: [resolve('apps/web')] })).href);
const tailwind = require(require.resolve('tailwindcss', { paths: [resolve('apps/web')] }));
const loadConfig = require(require.resolve('tailwindcss/loadConfig', { paths: [resolve('apps/web')] }));
const cssConfig = loadConfig(resolve('apps/web/tailwind.config.ts'));
cssConfig.content = [resolve('apps/web/src/**/*.{ts,tsx}'), resolve('packages/ui/src/**/*.{ts,tsx}'), resolve('scripts/qa/material-navigation-session-fixture.tsx')];
const { chromium } = await import(pathToFileURL(process.env.CPMS_PLAYWRIGHT_PATH).href);
const output = resolve('private-local/material-navigation-session-qa');
await mkdir(output, { recursive: true });
const html = resolve('apps/web/material-nav-qa.html'), entry = resolve('apps/web/material-nav-qa.tsx');
let browser, server;
const checks = [], errors = [];
const check = message => { checks.push(message); console.log('PASS:', message); };
let meStatus = 200, meDelay = 0, probes = 0, protectedStatus = 200;
let me = { account: { id: 'qa-actor', displayName: 'QA Actor', accountKind: 'PERSONNEL', recordVersion: 1, roles: [], mustChangePassword: false }, originalActor: {id:'qa-actor',displayName:'QA Actor'}, mode:'DIRECT', directSuperadmin:false, expiresAt: new Date(Date.now()+3600000).toISOString(), mustChangePassword:false, scopedBoundaryReady:true };
const drafts = new Map();
try {
  await writeFile(entry, (await readFile('scripts/qa/material-navigation-session-fixture.tsx', 'utf8')).replaceAll('../../apps/web/', './'));
  await writeFile(html, '<!doctype html><html lang="vi"><head><meta charset="utf-8"><link rel="icon" href="data:,"></head><body><div id="root"></div><script type="module" src="/material-nav-qa.tsx"></script></body></html>');
  await build({ root: resolve('apps/web'), configFile: resolve('apps/web/vite.config.ts'), css: { postcss: { plugins: [tailwind(cssConfig)] } }, build: { outDir: output + '/dist', emptyOutDir: true, rollupOptions: { input: html } } });
  server = createServer(async (req,res) => {
    const url = new URL(req.url,'http://127.0.0.1');
    if (url.pathname.startsWith('/api/')) {
      let raw=''; for await (const chunk of req) raw+=chunk;
      const body=raw?JSON.parse(raw):null;
      res.setHeader('content-type','application/json');
      if(url.pathname==='/api/auth/me') { probes++; const status=meStatus, identity=me; await new Promise(done=>setTimeout(done,meDelay)); res.statusCode=status;res.end(JSON.stringify(status===200?identity:{message:'Synthetic probe failure'}));return; }
      if(url.pathname==='/api/auth/login') { meStatus=200;res.end(JSON.stringify(me));return; }
      if(url.pathname==='/api/auth/logout') { meStatus=401;res.end('{"loggedOut":true}');return; }
      if(url.pathname==='/api/qa-protected') {res.statusCode=protectedStatus;res.end('{}');return;}
      if(url.pathname.startsWith('/api/grid-drafts/')) {
        let draft=drafts.get(url.pathname)||{value:{},recordVersion:0};
        if(req.method==='PUT'){draft={value:body.value,recordVersion:draft.recordVersion+1};drafts.set(url.pathname,draft);}
        res.end(JSON.stringify(draft));return;
      }
      res.statusCode=400;res.end('{"message":"Unexpected synthetic route"}');return;
    }
    try {
      const file=resolve(output,'dist','.'+(url.pathname==='/'?'/material-nav-qa.html':url.pathname));
      assert.ok(file.startsWith(resolve(output,'dist')));
      res.setHeader('content-type',({'.js':'text/javascript','.css':'text/css','.html':'text/html'})[extname(file)]||'application/octet-stream');
      res.end(await readFile(file));
    } catch {res.statusCode=404;res.end();}
  });
  await new Promise(done=>server.listen(0,'127.0.0.1',done));
  const origin='http://127.0.0.1:'+server.address().port;
  browser=await chromium.launch({channel:'msedge',headless:true});
  const context=await browser.newContext({viewport:{width:1600,height:1000}});
  await context.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():route.abort());
  const page=await context.newPage();page.setDefaultTimeout(12000);
  page.on('pageerror',error=>errors.push(error.message));
  page.on('dialog',dialog=>dialog.accept());
  await page.goto(origin);
  await page.getByLabel('Gộp nhóm',{exact:true}).selectOption('NONE');
  const cell=key=>page.locator('[data-row-id="qa-material"][data-field-key="'+key+'"]');
  const viewport=()=>page.locator('[data-supply-grid-scroll]');
  const scrollFar=()=>viewport().evaluate(el=>{el.scrollLeft=el.scrollWidth;});
  const isRevealed=async key=>{
    const geometry=await cell(key).evaluate(el=>{
      const pane=el.closest('[data-supply-grid-scroll]'),box=el.getBoundingClientRect(),outer=pane.getBoundingClientRect();
      const right=Math.max(...[...pane.querySelectorAll('[data-reveal-header="true"][data-pinned="true"]')].map(header=>header.getBoundingClientRect().right));
      return {left:box.left,right:box.right,pinned:right,end:outer.left+pane.clientWidth};
    });
    assert.ok(geometry.left>=geometry.pinned-2,JSON.stringify(geometry));
    assert.ok(geometry.right<=geometry.end+2,JSON.stringify(geometry));
  };
  await scrollFar();await cell('material_name').click();await page.keyboard.press('ArrowRight');
  await page.waitForFunction(()=>document.activeElement?.getAttribute('data-field-key')==='material_link');
  await isRevealed('material_link');
  check('ArrowRight C -> D reveals D beside frozen A-C when previously scrolled to far right');
  await scrollFar();const before=await viewport().evaluate(el=>el.scrollLeft);
  await cell('campaign').click();await page.keyboard.press('ArrowRight');
  await page.waitForFunction(()=>document.activeElement?.getAttribute('data-field-key')==='material_name');
  assert.equal(await viewport().evaluate(el=>el.scrollLeft),before);
  await page.keyboard.press('Tab');await page.waitForFunction(()=>document.activeElement?.getAttribute('data-field-key')==='material_link');await isRevealed('material_link');
  await page.keyboard.press('Shift+Tab');await page.waitForFunction(()=>document.activeElement?.getAttribute('data-field-key')==='material_name');
  check('Pinned-to-pinned navigation keeps horizontal position; Tab and Shift+Tab cross boundary correctly');
  await scrollFar();await page.getByLabel('Địa chỉ ô',{exact:true}).fill('D1');await page.getByLabel('Địa chỉ ô',{exact:true}).press('Enter');await page.waitForFunction(()=>document.activeElement?.getAttribute('data-field-key')==='material_link');await isRevealed('material_link');
  for(const key of ['material_type','publish_status','material_description_rich_text','note','campaign_effect_start_date','campaign_effect_end_date','campaign_departure_start_date']){await page.keyboard.press('ArrowRight');await page.waitForFunction(key=>document.activeElement?.getAttribute('data-field-key')===key,key);}
  await isRevealed('campaign_departure_start_date');
  check('Address navigation and repeated ArrowRight reveal active columns');
  await cell('campaign_effect_start_date').scrollIntoViewIfNeeded();
  assert.equal((await cell('campaign_effect_start_date').innerText()).trim(),'01/10/2026');
  assert.equal((await cell('campaign_departure_end_date').innerText()).trim(),'28/02/2027');
  await cell('campaign_effect_start_date').dblclick();assert.equal(await cell('campaign_effect_start_date').locator('input').count(),0);
  check('Four Campaign validity columns display canonical dates and remain read-only');
  const layoutKey='cpms-material-sheet-v1:qa-actor:portal:all';
  const originalLayout=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),layoutKey);
  await viewport().evaluate(el=>{el.scrollLeft=0;});
  const handle=await page.getByRole('separator',{name:'Đổi rộng Ngày cập nhật',exact:true}).boundingBox();
  await page.mouse.move(handle.x+handle.width/2,handle.y+handle.height/2);await page.mouse.down();await page.mouse.move(handle.x+70,handle.y+handle.height/2,{steps:5});await page.mouse.up();
  await scrollFar();await cell('material_name').click();await page.keyboard.press('ArrowRight');await page.waitForFunction(()=>document.activeElement?.getAttribute('data-field-key')==='material_link');await isRevealed('material_link');
  check('Mouse-resized pinned column width is respected during keyboard reveal');
  const installLayout=async layout=>{await page.evaluate(({key,layout})=>localStorage.setItem(key,JSON.stringify(layout)),{key:layoutKey,layout});await page.reload();await cell('material_name').waitFor();};
  await installLayout({...originalLayout,widths:{...originalLayout.widths,material_link:650}});
  await scrollFar();await cell('material_name').click();await page.keyboard.press('ArrowRight');await page.waitForFunction(()=>document.activeElement?.getAttribute('data-field-key')==='material_link');
  const wide=await cell('material_link').evaluate(el=>({left:el.getBoundingClientRect().left,pin:document.querySelector('th[data-supply-column="material_name"]').getBoundingClientRect().right}));
  assert.ok(Math.abs(wide.left-wide.pin)<2);
  check('A target wider than available pane aligns its beginning after pinned columns');
  await installLayout({...originalLayout,pinned:[],hidden:[...originalLayout.hidden,'material_type']});
  await scrollFar();await page.getByLabel('Địa chỉ ô',{exact:true}).fill('A1');await page.getByLabel('Địa chỉ ô',{exact:true}).press('Enter');
  await page.waitForFunction(()=>document.activeElement?.getAttribute('data-field-key')==='material_update_date');
  const gutter=await cell('material_update_date').evaluate(el=>{const pane=el.closest('[data-supply-grid-scroll]');return el.getBoundingClientRect().left-pane.getBoundingClientRect().left;});
  assert.ok(gutter>=99);check('Unpinned grid navigation still respects the frozen row-number/checkbox gutter');
  await installLayout(originalLayout);
  // Focus probe fails while an inline editor has unsaved text.
  await viewport().evaluate(el=>{el.scrollLeft=0;});
  await cell('material_name').dblclick();const input=page.getByLabel('Sửa Tiêu đề tư liệu',{exact:true});
  await input.fill('Nội dung chưa chốt ô');
  meStatus=503;let response=page.waitForResponse(r=>r.url().endsWith('/auth/me'));
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await response;
  await page.getByRole('alert').filter({hasText:'kết nối gián đoạn'}).waitFor();
  assert.equal(await input.inputValue(),'Nội dung chưa chốt ô');
  assert.equal(await page.getByRole('heading',{name:'Đăng nhập CPMS'}).count(),0);
  check('Focus + 503 preserves authenticated grid and inline editor content');
  await context.route('**/api/auth/me',route=>route.abort('failed'));
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await page.waitForTimeout(100);assert.equal(await input.inputValue(),'Nội dung chưa chốt ô');
  await context.unroute('**/api/auth/me');
  meStatus=200;meDelay=250;const count=probes;response=page.waitForResponse(r=>r.url().endsWith('/auth/me'));
  await page.evaluate(()=>{for(let n=0;n<8;n++)window.dispatchEvent(new Event('focus'));});await response;
  await page.getByRole('alert').filter({hasText:'kết nối gián đoạn'}).waitFor({state:'hidden'});
  assert.equal(probes-count,1);assert.equal(await input.inputValue(),'Nội dung chưa chốt ô');meDelay=0;
  check('Offline preserves input; recovery deduplicates focus probes without remounting');
  protectedStatus=401;response=page.waitForResponse(r=>r.url().endsWith('/auth/me'));
  await page.getByRole('button',{name:'Kiểm thử yêu cầu bảo vệ'}).click();await response;
  assert.equal(await page.getByRole('heading',{name:'Đăng nhập CPMS'}).count(),0);
  check('A non-session 401 is checked against authoritative identity before logout');
  meStatus=401;response=page.waitForResponse(r=>r.url().endsWith('/auth/me'));
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await response;
  await page.getByRole('heading',{name:'Đăng nhập CPMS'}).waitFor();
  assert.equal(await page.locator('[data-supply-grid-scroll]').count(),0);
  check('Confirmed revoked/expired session removes protected UI');
  await page.getByLabel('Email công việc').fill('qa@example.test');await page.getByLabel('Mật khẩu CPMS',{exact:true}).fill('synthetic-only');
  const loginProbeCount=probes;await page.getByRole('button',{name:'Đăng nhập',exact:true}).click();
  await page.locator('[data-supply-grid-scroll]').waitFor();assert.equal(probes,loginProbeCount);
  check('Successful login opens CPMS from server identity response without redundant me request');
  await page.getByLabel('Gộp nhóm',{exact:true}).selectOption('NONE');
  await viewport().evaluate(el=>{el.scrollLeft=0;});
  await page.screenshot({path:output+'/grid-pin-navigation.png'});
  // No previous identity: a network failure must not be mistaken for a logged-out account.
  meStatus=503;await page.reload();await page.getByRole('button',{name:'Thử kết nối lại',exact:true}).waitFor();
  assert.equal(await page.getByRole('heading',{name:'Đăng nhập CPMS'}).count(),0);
  meStatus=200;me={...me,expiresAt:new Date(Date.now()+1600).toISOString()};
  await page.getByRole('button',{name:'Thử kết nối lại',exact:true}).click();await page.locator('[data-supply-grid-scroll]').waitFor();
  await page.getByRole('heading',{name:'Đăng nhập CPMS'}).waitFor();check('Initial connection failure offers retry; genuine absolute expiry is still enforced');
  assert.deepEqual(errors,[]);await writeFile(output+'/result.json',JSON.stringify({checks,errors,productionWrites:0},null,2));
} catch(error) {if(browser){const pages=browser.contexts()[0]?.pages();if(pages?.[0])await pages[0].screenshot({path:output+'/failure.png'});}throw error;}
finally {await browser?.close();if(server)await new Promise(done=>server.close(done));await unlink(entry).catch(()=>{});await unlink(html).catch(()=>{});}
