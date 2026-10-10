import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { comprobarDespliegue, comprobarFormulario, buscarSecretos } from '../scripts/comprobar-despliegue.mjs';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INDICE = fs.readFileSync(path.join(RAIZ, 'public', 'index.html'), 'utf8');

test('public/index.html es el cuestionario del kit con el envío al servidor', () => {
  assert.deepEqual(comprobarFormulario(INDICE), []);
  assert.match(INDICE, /data-accion="enviar-web"/);
  assert.match(INDICE, /id="envio-consentimiento"/);
  assert.match(INDICE, /href="\/privacidad"/);
  assert.match(INDICE, /data-accion="borrar-local"/);
  assert.doesNotMatch(INDICE, /mode: 'no-cors'/, 'sin el envío ciego que daba «Enviado» aunque fallara');
});

test('el JavaScript del cuestionario se puede interpretar (sin errores de sintaxis)', () => {
  const scripts = [...INDICE.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  assert.ok(scripts.length >= 1);
  for (const s of scripts) assert.doesNotThrow(() => new vm.Script(s));
});

test('borradores legales: build correcto con envíos desactivados, falla si se activan', () => {
  const desactivado = comprobarDespliegue({ env: {} });
  assert.deepEqual(desactivado.errores, []);
  assert.equal(desactivado.avisos.length, 2);
  const activado = comprobarDespliegue({ env: { ENVIOS_HABILITADOS: 'true', AVISO_PRIVACIDAD_VERSION: 'x' } });
  assert.ok(activado.errores.some((e) => e.includes('privacidad.html') && e.includes('[POR COMPLETAR]')));
  assert.ok(activado.errores.some((e) => e.includes('aviso-legal.html')));
});

test('ningún archivo del repositorio contiene secretos', () => {
  const ignorar = new Set(['.git', 'node_modules', '.vercel']);
  const hallazgos = [];
  const recorrer = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (ignorar.has(e.name)) continue;
      const ruta = path.join(dir, e.name);
      if (e.isDirectory()) recorrer(ruta);
      else if (!/^\.env(\.|$)/.test(e.name) || e.name === '.env.example') {
        const texto = fs.readFileSync(ruta, 'utf8');
        // Los valores de prueba (claramente falsos) de tests/ayudas.js no cuentan.
        const s = buscarSecretos(texto.replace(/sb_secret_clave-de-prueba-no-real|eyJhbGciOiJIUzI1NiJ9\.eyJyb2xlIjoic2VydmljZV9yb2xlIn0\.firma-de-prueba/g, ''));
        if (s.length) hallazgos.push(`${path.relative(RAIZ, ruta)}: ${s.join(', ')}`);
        if (/@gmail\.com/i.test(texto)) hallazgos.push(`${path.relative(RAIZ, ruta)}: dirección de Gmail`);
      }
    }
  };
  recorrer(RAIZ);
  assert.deepEqual(hallazgos, []);
});

test('.gitignore excluye .env reales, credenciales y respuestas de clientes', () => {
  const gi = fs.readFileSync(path.join(RAIZ, '.gitignore'), 'utf8');
  for (const p of ['.env', '.env.*', '!.env.example', '.vercel/', 'node_modules/', 'respuestas-*.json', 'entrada/', '*.pem']) assert.ok(gi.split(/\r?\n/).includes(p), `falta ${p}`);
});

test('.env.example no lleva valores', () => {
  const lineas = fs.readFileSync(path.join(RAIZ, '.env.example'), 'utf8').split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l));
  assert.ok(lineas.length >= 7);
  for (const l of lineas) assert.match(l, /^[A-Z_]+=$/, `${l} debería estar vacío`);
});

test('vercel.json: cabeceras de seguridad y CSP compatible con el cuestionario', () => {
  const v = JSON.parse(fs.readFileSync(path.join(RAIZ, 'vercel.json'), 'utf8'));
  const cab = Object.fromEntries(v.headers.flatMap((h) => h.headers).map((h) => [h.key, h.value]));
  const csp = cab['Content-Security-Policy'];
  for (const d of ["default-src 'none'", "connect-src 'self'", "frame-ancestors 'none'", "img-src 'self' data:"]) assert.ok(csp.includes(d), d);
  assert.equal(cab['X-Content-Type-Options'], 'nosniff');
  assert.equal(v.outputDirectory, 'public');
  // El cuestionario no carga nada de fuera (si lo hiciera, la CSP lo bloquearía).
  assert.doesNotMatch(INDICE, /<(script|link|img)[^>]+(src|href)="https?:/);
});
