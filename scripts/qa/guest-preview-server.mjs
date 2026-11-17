import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';

const root = resolve('apps/web/dist');
const types = { '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.html': 'text/html' };
const server = createServer(async (request, response) => {
  const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
  if (pathname.startsWith('/api/')) {
    response.writeHead(401, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify({ message: 'Hãy đăng nhập CPMS.' }));
    return;
  }
  const file = resolve(root, `.${pathname}`);
  const target = file.startsWith(`${root}${sep}`) && extname(file) ? file : resolve(root, 'index.html');
  try {
    const body = await readFile(target);
    response.writeHead(200, { 'Content-Type': types[extname(target)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
    response.end(body);
  } catch {
    response.writeHead(404); response.end('Not found');
  }
});
server.listen(4174, '127.0.0.1', () => process.stdout.write('Guest QA server ready on 127.0.0.1:4174\n'));
