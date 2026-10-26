import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Runs the production web build against the harness's isolated API, never production. */
export async function checkMaterialSharingBrowser({ apiBase, playwrightPath, owner, reader, materialId, change, configureOrigin }) {
  assert.equal(new URL(apiBase).hostname, '127.0.0.1');
  const root = resolve('apps/web/dist');
  const server = createServer(async (req, res) => {
    if (req.url.startsWith('/api/')) {
      const proxy = request(new URL(req.url, apiBase), { method: req.method, headers: req.headers }, upstream => {
        res.writeHead(upstream.statusCode, upstream.headers); upstream.pipe(res);
      });
      proxy.on('error', () => { res.writeHead(502); res.end(); }); req.pipe(proxy); return;
    }
    try {
      const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      const file = extname(pathname) ? resolve(root, '.' + pathname) : resolve(root, 'index.html');
      if (!file.startsWith(root + sep)) { res.writeHead(404); res.end(); return; }
      const data = await readFile(file);
      res.setHeader('content-type', ({ '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.png': 'image/png', '.svg': 'image/svg+xml' })[extname(file)] || 'application/octet-stream');
      res.end(data);
    } catch { res.writeHead(404); res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  configureOrigin(origin);
  const { chromium } = await import(pathToFileURL(playwrightPath).href);
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const errors = [], checks = [];
  const context = async identity => {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    if (identity) await ctx.addCookies([
      { name: 'cpms_session', value: identity.token, url: origin, httpOnly: true },
      { name: 'cpms_csrf', value: identity.csrf, url: origin },
    ]);
    const page = await ctx.newPage(); page.on('pageerror', error => errors.push(error.message));
    return page;
  };
  try {
    await mkdir('private-local/material-sharing', { recursive: true });
    const anonymous = await context();
    await anonymous.goto(origin + '/public/materials');
    await anonymous.getByRole('link', { name: 'Synthetic public KV', exact: true }).waitFor();
    assert.equal(await anonymous.getByLabel('Email công việc').count(), 0);
    await anonymous.getByRole('link', { name: 'Synthetic public KV', exact: true }).click();
    await anonymous.getByRole('link', { name: 'Mở Link tư liệu' }).waitFor();
    assert.equal(await anonymous.getByRole('link', { name: 'Mở Link tư liệu' }).getAttribute('href'), 'https://example.test/folder');
    await anonymous.screenshot({ path: 'private-local/material-sharing/public.png', fullPage: true });
    checks.push('Anonymous browser list/detail without AuthProvider or login; correct link');

    const admin = await context(owner);
    await admin.goto(origin + '/materials/' + materialId + '/edit');
    await admin.getByRole('button', { name: 'Chia sẻ', exact: true }).click();
    const dialog = admin.getByRole('dialog', { name: 'Chia sẻ tư liệu' });
    await dialog.getByLabel('Phạm vi truy cập').selectOption('CAMPAIGN');
    assert.equal(await dialog.getByRole('checkbox', { name: 'Synthetic other campaign', exact: true }).isChecked(), true);
    await dialog.getByLabel('Phạm vi truy cập').selectOption('RESTRICTED');
    await dialog.getByLabel('Người hoặc đơn vị').selectOption('ACCOUNT:' + reader.actor.id);
    await dialog.getByRole('button', { name: 'Thêm', exact: true }).click();
    await change('SHARED'); // A concurrent command increments the real server version.
    await dialog.getByRole('button', { name: 'Lưu thay đổi' }).click();
    await dialog.getByText('Lựa chọn chưa lưu vẫn được giữ.', { exact: true }).waitFor();
    assert.equal(await dialog.getByLabel('Phạm vi truy cập').inputValue(), 'RESTRICTED');
    await dialog.getByRole('button', { name: 'Tải phiên bản để đối chiếu' }).click();
    await dialog.getByText('Đã tải phiên bản mới.', { exact: false }).waitFor();
    await dialog.screenshot({ path: 'private-local/material-sharing/sharing-dialog.png' });
    await dialog.getByRole('button', { name: 'Lưu thay đổi' }).click();
    await dialog.waitFor({ state: 'hidden' });
    await anonymous.reload();
    await anonymous.getByRole('alert').filter({ hasText: 'Không tìm thấy tư liệu.' }).waitFor();
    assert.equal(await anonymous.getByRole('link', { name: 'Mở Link tư liệu' }).count(), 0);
    checks.push('Sharing dialog: campaign suggestion, account VIEW grant, conflict retains input, reload/retry succeeds, public refetch revoked');

    const viewer = await context(reader);
    await viewer.goto(origin + '/materials/' + materialId + '/edit');
    await viewer.getByLabel('Tiêu đề tư liệu *', { exact: true }).waitFor();
    assert.equal(await viewer.getByLabel('Tiêu đề tư liệu *', { exact: true }).inputValue(), 'Synthetic public KV');
    assert.equal(await viewer.getByLabel('Tiêu đề tư liệu *', { exact: true }).isDisabled(), true);
    assert.equal(await viewer.getByRole('button', { name: 'Lưu tư liệu', exact: true }).isDisabled(), true);
    assert.equal(await viewer.getByRole('button', { name: 'Chia sẻ', exact: true }).count(), 0);
    await viewer.screenshot({ path: 'private-local/material-sharing/reader.png', fullPage: true });
    checks.push('Authenticated VIEW grantee sees form but cannot edit/save/manage sharing');
    await admin.goto(origin + '/materials/new');
    await admin.getByLabel('Phạm vi truy cập').waitFor();
    assert.equal(await admin.getByLabel('Phạm vi truy cập').inputValue(), 'SHARED');
    await admin.getByText('Mọi người, kể cả khách chưa đăng nhập, đều có thể xem.', { exact: true }).waitFor();
    checks.push('New form defaults SHARED with explicit anonymous-read explanation; no business save');
    assert.deepEqual(errors, []);
    return { checks, pageErrors: errors };
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
}
