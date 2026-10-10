/* Servidor de pruebas en tu ordenador: sirve public/ con las mismas cabeceras y
 * rutas limpias que vercel.json, y /api/enviar con la misma función que Vercel.
 *
 *   node --env-file=.env.local scripts/servidor-local.mjs      → http://127.0.0.1:3000
 *
 * Solo escucha en 127.0.0.1. No sustituye a una prueba en Vercel (Preview). */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import handler from '../api/enviar.js';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLICO = path.join(RAIZ, 'public');
const VERCEL = JSON.parse(fs.readFileSync(path.join(RAIZ, 'vercel.json'), 'utf8'));
const CABECERAS = VERCEL.headers.flatMap((h) => h.headers).filter((h) => h.key !== 'Strict-Transport-Security');
const TIPOS = { '.html': 'text/html; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

function archivoPara(url) {
  const p = decodeURIComponent(new URL(url, 'http://x').pathname);
  if (p.includes('..')) return null;
  const candidatos = p === '/' ? ['index.html'] : [p.slice(1), `${p.slice(1)}.html`];
  for (const c of candidatos) {
    const f = path.join(PUBLICO, c);
    if (f.startsWith(PUBLICO) && fs.existsSync(f) && fs.statSync(f).isFile()) return f;
  }
  return null;
}

export function crearServidor({ env = process.env, fetch = globalThis.fetch } = {}) {
  return http.createServer(async (req, res) => {
    for (const h of CABECERAS) res.setHeader(h.key, h.value);
    if (new URL(req.url, 'http://x').pathname === '/api/enviar') return handler(req, res, { env, fetch });
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.statusCode = 405; return res.end(); }
    const f = archivoPara(req.url);
    if (!f) { res.statusCode = 404; return res.end('No encontrado'); }
    res.setHeader('Content-Type', TIPOS[path.extname(f)] || 'application/octet-stream');
    res.end(req.method === 'HEAD' ? undefined : fs.readFileSync(f));
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const puerto = Number(process.env.PORT) || 3000;
  crearServidor().listen(puerto, '127.0.0.1', () => console.log(`✓ http://127.0.0.1:${puerto}  (Ctrl+C para parar)`));
}
