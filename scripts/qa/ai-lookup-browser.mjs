import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { pathToFileURL, URL } from 'node:url';

export async function checkAiLookupBrowser({ apiBase, playwrightPath, pilot, other, configureOrigin }) {
  assert.equal(new URL(apiBase).hostname, '127.0.0.1');
  const root = resolve('apps/web/dist'), screenshots = 'private-local/ai-pilot';
  const server = createServer(async (req, res) => {
    if (req.url.startsWith('/api/')) {
      const upstream = request(new URL(req.url, apiBase), { method: req.method, headers: req.headers }, response => {
        res.writeHead(response.statusCode, response.headers); response.pipe(res);
      });
      upstream.on('error', () => { res.writeHead(502); res.end(); }); req.pipe(upstream); return;
    }
    try {
      const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      const file = extname(pathname) ? resolve(root, '.' + pathname) : resolve(root, 'index.html');
      if (!file.startsWith(root + sep)) { res.writeHead(404); res.end(); return; }
      res.setHeader('content-type', ({ '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.png': 'image/png', '.svg': 'image/svg+xml' })[extname(file)] || 'application/octet-stream');
      res.end(await readFile(file));
    } catch { res.writeHead(404); res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`; configureOrigin(origin);
  const { chromium } = await import(pathToFileURL(playwrightPath).href);
  const browser = await chromium.launch({ channel: 'msedge', headless: true }), errors = [], checks = [];
  const open = async identity => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.addCookies([{ name: 'cpms_session', value: identity.token, url: origin, httpOnly: true }, { name: 'cpms_csrf', value: identity.csrf, url: origin }]);
    const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin); return page;
  };
  try {
    await mkdir(screenshots, { recursive: true });
    const page = await open(pilot);
    await page.getByRole('heading', { name: 'Hôm nay, bạn cần tìm gì?' }).waitFor();
    await page.getByText('Mô phỏng · Không gọi AI', { exact: false }).waitFor();
    await page.getByRole('button', { name: 'Tư liệu của tôi', exact: true }).waitFor();
    const nav = page.getByRole('navigation', { name: 'Điều hướng chính' });
    assert.equal(await nav.getByRole('link').nth(0).getAttribute('href'), '/');
    assert.equal(await nav.getByRole('link').nth(1).getAttribute('href'), '/overview');
    await page.screenshot({ path: `${screenshots}/home-desktop.png`, fullPage: true });
    await page.getByRole('button', { name: /Tìm tư liệu đang có/ }).click();
    await page.getByRole('button', { name: 'Gửi', exact: true }).click();
    const source = page.getByRole('link', { name: 'Video mẫu CPMS', exact: true });
    await source.waitFor();
    const chatUrl = page.url();
    await page.screenshot({ path: `${screenshots}/answer-desktop.png`, fullPage: true });
    await source.click();
    await page.getByText('Tư liệu được mở từ nguồn dẫn', { exact: true }).waitFor();
    await page.getByText('Video mẫu CPMS', { exact: true }).first().waitFor();
    assert(!await page.getByText('Hidden sentinel 7f10', { exact: true }).count());
    checks.push('Home route, AI first, overview second; suggestion, ask, answer and source navigation');
    await nav.getByRole('link', { name: 'Tổng quan', exact: true }).click();
    await page.waitForURL('**/overview');
    assert(new URL(page.url()).pathname === '/overview');
    await nav.getByRole('link', { name: 'Trợ lý AI', exact: true }).click();
    const title = 'Tìm giúp tôi các tư liệu video đang có trên CPMS.';
    await page.getByRole('button', { name: title, exact: true }).click();
    await page.waitForURL(chatUrl);
    assert.equal(page.url(), chatUrl);
    await page.reload();
    await page.getByRole('link', { name: 'Video mẫu CPMS', exact: true }).waitFor();
    await page.getByLabel('Câu hỏi cho Trợ lý AI').fill('Tiếp tục tìm tư liệu');
    await page.getByRole('button', { name: 'Gửi', exact: true }).click();
    await page.getByText('Tiếp tục tìm tư liệu', { exact: true }).waitFor();
    await page.getByRole('button', { name: `Đổi tên ${title}`, exact: true }).click();
    await page.getByLabel('Tên hội thoại').fill('Tra cứu tư liệu đã lưu');
    await page.getByRole('button', { name: 'Lưu tên', exact: true }).click();
    await page.getByRole('heading', { name: 'Tra cứu tư liệu đã lưu', exact: true }).waitFor();
    await page.reload();
    await page.getByRole('heading', { name: 'Tra cứu tư liệu đã lưu', exact: true }).waitFor();
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: 'Xóa Tra cứu tư liệu đã lưu', exact: true }).click();
    await page.getByRole('heading', { name: 'Hôm nay, bạn cần tìm gì?' }).waitFor();
    checks.push('Chat survives navigation and reload; reopen, continue, rename persists, confirmed deletion');
    await page.getByRole('button', { name: 'Hội thoại mới', exact: true }).click();
    await page.getByRole('button', { name: 'Lịch sử', exact: true }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: `${screenshots}/home-mobile.png`, fullPage: true });
    assert(await page.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth));
    checks.push('Overview retained; new conversation; mobile without horizontal overflow');
    const outsider = await open(other);
    await outsider.getByRole('heading', { name: 'Hôm nay, bạn cần tìm gì?' }).waitFor();
    await outsider.getByLabel('Câu hỏi cho Trợ lý AI').fill('Test');
    assert(await outsider.getByRole('button', { name: 'Gửi', exact: true }).isDisabled());
    checks.push('Non-pilot sees AI home but cannot spend');
    assert.deepEqual(errors, []);
    return { checks, consoleErrors: errors };
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
}
