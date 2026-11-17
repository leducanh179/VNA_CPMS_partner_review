// Local-only visual QA proxy. Pair with ENGAGEMENT_QA_HOLD=true on the disposable integration harness.
import { createServer, request as proxyRequest } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
const root=resolve('apps/web/dist');
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.webp':'image/webp','.svg':'image/svg+xml'};
createServer(async(req,res)=>{
  const url=new URL(req.url??'/','http://localhost');
  if(url.pathname.startsWith('/api/')) {
    const proxy=proxyRequest({hostname:'127.0.0.1',port:3184,path:req.url,method:req.method,headers:req.headers},upstream=>{res.writeHead(upstream.statusCode??502,upstream.headers);upstream.pipe(res);});
    proxy.on('error',()=>{res.writeHead(502);res.end('Start the disposable engagement integration harness.');});req.pipe(proxy);return;
  }
  const path=resolve(root,`.${url.pathname}`),file=path.startsWith(root+sep)&&extname(path)?path:resolve(root,'index.html');
  try {const body=await readFile(file);res.writeHead(200,{'Content-Type':mime[extname(file)]??'application/octet-stream','Cache-Control':'no-store'});res.end(body);} catch {res.writeHead(404);res.end();}
}).listen(4176,'127.0.0.1',()=>console.log('Synthetic engagement web QA: http://127.0.0.1:4176'));
