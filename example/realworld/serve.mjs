// Serves the repository so the example can import the library source directly.
// The app has no build step: it is ES modules loaded straight from src/.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

let root = normalize(join(import.meta.dirname, '..', '..'));
let port = Number(process.env.PORT || 8123);
let contentTypes = new Map([
    ['.html', 'text/html; charset=utf-8'],
    ['.js', 'text/javascript; charset=utf-8'],
    ['.mjs', 'text/javascript; charset=utf-8'],
    ['.css', 'text/css; charset=utf-8'],
    ['.json', 'application/json; charset=utf-8']
]);

createServer(async (request, response) => {
    try {
        let pathname = new URL(request.url, 'http://localhost').pathname;
        if (pathname === '/') pathname = '/example/realworld/index.html';
        let file = normalize(join(root, pathname));
        if (!file.startsWith(root)) throw new Error('Invalid path');
        response.setHeader('content-type', contentTypes.get(extname(file)) || 'application/octet-stream');
        response.end(await readFile(file));
    } catch {
        response.writeHead(404).end('Not found');
    }
}).listen(port, '127.0.0.1', () => {
    console.log(`Conduit running at http://127.0.0.1:${port}/`);
});
