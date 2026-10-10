/* Prueba en un navegador real (Chrome o Edge sin ventana) del bloque de envío del
 * cuestionario, contra el servidor local y la función real de api/enviar.js.
 * Supabase y n8n están SIMULADOS (tests/ayudas.js): no se conecta nada real.
 *
 *   npm run test:navegador
 *
 * Usa el protocolo de depuración de Chrome por WebSocket (Node 22), sin dependencias. */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { crearServidor } from '../../scripts/servidor-local.mjs';
import { serviciosFalsos, entorno, RESPUESTAS, copia } from '../ayudas.js';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLAVE = 'diagnostico-procesos/CLEAN/general';
const NAVEGADORES = [
  process.env.CHROME,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium',
].filter(Boolean);

const resultados = [];
const comprobar = (nombre, ok, detalle = '') => { resultados.push({ nombre, ok, detalle }); console.log(`${ok ? '✓' : '✗'} ${nombre}${!ok && detalle ? ` — ${detalle}` : ''}`); };
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

function conectar(wsUrl) {
  return new Promise((resolver, rechazar) => {
    const ws = new WebSocket(wsUrl);
    let n = 0;
    const pendientes = new Map();
    const oyentes = [];
    ws.onmessage = (m) => {
      const d = JSON.parse(m.data);
      if (d.id && pendientes.has(d.id)) { const p = pendientes.get(d.id); pendientes.delete(d.id); d.error ? p.rechazar(new Error(d.error.message)) : p.resolver(d.result); }
      else if (d.method) oyentes.forEach((f) => f(d));
    };
    ws.onerror = rechazar;
    ws.onopen = () => resolver({
      enviar: (method, params = {}) => new Promise((ok, ko) => { const id = ++n; pendientes.set(id, { resolver: ok, rechazar: ko }); ws.send(JSON.stringify({ id, method, params })); }),
      on: (f) => oyentes.push(f),
      cerrar: () => ws.close(),
    });
  });
}

async function main() {
  const nav = NAVEGADORES.find((p) => fs.existsSync(p));
  if (!nav) { console.log('✗ No encuentro Chrome ni Edge. Pon su ruta en la variable CHROME.'); process.exit(1); }

  const env = entorno();
  const servicios = serviciosFalsos();
  const servidor = crearServidor({ env, fetch: servicios.fetch });
  await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${servidor.address().port}`;

  const perfil = fs.mkdtempSync(path.join(os.tmpdir(), 'clean-e2e-'));
  const chrome = spawn(nav, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', `--user-data-dir=${perfil}`, '--remote-debugging-port=0', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  const wsNavegador = await new Promise((resolver, rechazar) => {
    let txt = '';
    chrome.stderr.on('data', (d) => { txt += d; const m = txt.match(/DevTools listening on (ws:\/\/\S+)/); if (m) resolver(m[1]); });
    setTimeout(() => rechazar(new Error('Chrome no arranca')), 15000);
  });
  const puertoDevtools = new URL(wsNavegador).port;
  const paginas = await (await fetch(`http://127.0.0.1:${puertoDevtools}/json/list`)).json();
  const cdp = await conectar(paginas.find((p) => p.type === 'page').webSocketDebuggerUrl);

  const problemasConsola = [];
  cdp.on((e) => {
    if (e.method === 'Runtime.exceptionThrown') problemasConsola.push(e.params.exceptionDetails.exception?.description || e.params.exceptionDetails.text);
    if (e.method === 'Log.entryAdded' && !/favicon\.ico$|\/api\/enviar$/.test(e.params.entry.url || '') && (e.params.entry.level === 'error' || /Content Security Policy/i.test(e.params.entry.text))) problemasConsola.push(e.params.entry.text);
    if (e.method === 'Page.javascriptDialogOpening') cdp.enviar('Page.handleJavaScriptDialog', { accept: true });
  });
  await cdp.enviar('Page.enable');
  await cdp.enviar('Runtime.enable');
  await cdp.enviar('Log.enable');

  const evaluar = async (expr) => (await cdp.enviar('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result.value;
  const ir = async (url) => { const carga = new Promise((r) => { const f = (e) => { if (e.method === 'Page.loadEventFired') r(); }; cdp.on(f); }); await cdp.enviar('Page.navigate', { url }); await carga; await esperar(200); };
  const hasta = async (expr, ms = 6000) => { const fin = Date.now() + ms; while (Date.now() < fin) { if (await evaluar(expr)) return true; await esperar(100); } return false; };
  const textoEstado = () => evaluar("(document.getElementById('envio-estado')||{}).textContent||''");
  // Las respuestas se inyectan desde otra página del mismo sitio: al salir del
  // cuestionario, este guarda su estado (a propósito) y pisaría lo inyectado.
  const prepararRespuestas = async (respuestas, inicio = `${base}/robots.txt`, destino = `${base}/`) => {
    await ir(inicio);
    await evaluar(`localStorage.setItem(${JSON.stringify(CLAVE)}, ${JSON.stringify(JSON.stringify({ respuestas, ui: { seccion: 'enviar' } }))}); true`);
    await ir(destino);
  };
  const pulsar = (sel) => evaluar(`(function(){var b=document.querySelector(${JSON.stringify(sel)}); if(!b) return false; b.click(); return true;})()`);
  const escribir = (sel, v) => evaluar(`(function(){var e=document.querySelector(${JSON.stringify(sel)}); e.value=${JSON.stringify(v)}; e.dispatchEvent(new Event('input',{bubbles:true})); return true;})()`);

  try {
    // 1. Sin email ni casilla: el navegador no envía y dice qué falta.
    const sinEmail = copia(RESPUESTAS); sinEmail.respondente.email = '';
    await prepararRespuestas(sinEmail);
    comprobar('la sección de envío muestra la casilla, el enlace a privacidad y el botón', await evaluar("!!document.getElementById('envio-consentimiento') && !!document.querySelector('a[href=\"/privacidad\"]') && !!document.querySelector('[data-accion=\"enviar-web\"]')"));
    await pulsar('[data-accion="enviar-web"]');
    const t1 = await textoEstado();
    comprobar('sin email ni casilla no se envía y se explica qué falta', /email de contacto/.test(t1) && /casilla de privacidad/.test(t1) && servicios.llamadas.length === 0, t1);

    // 2. Envío correcto.
    await escribir('[data-campo="respondente.email"]', 'prueba@example.com');
    await pulsar('#envio-consentimiento');
    await pulsar('[data-accion="enviar-web"]');
    const recibido = await hasta("/Recibido/.test((document.getElementById('envio-estado')||{}).textContent||'')");
    comprobar('envío correcto: muestra «Recibido» con la referencia del servidor', recibido && /3F2A9C1E/.test(await textoEstado()), await textoEstado());
    comprobar('el servidor guardó una vez y avisó a n8n una vez', servicios.de('/rest/v1/diagnosticos').length === 1 && servicios.de('n8n.example.com').length === 1);
    comprobar('lo recibido es el archivo del cuestionario con el email escrito', servicios.de('/rest/v1/diagnosticos')[0]?.cuerpo.respuestas.respondente.email === 'prueba@example.com');
    comprobar('tras enviar, el botón queda desactivado («Enviado ✓»)', await evaluar("(function(){var b=document.querySelector('[data-accion=\"enviar-web\"]'); return b.disabled && /Enviado/.test(b.textContent);})()"));
    comprobar('las respuestas locales NO se borran solas al enviar', await evaluar(`!!localStorage.getItem(${JSON.stringify(CLAVE)}) && JSON.parse(localStorage.getItem(${JSON.stringify(CLAVE)})).respuestas.empresa.nombre === 'Empresa ficticia de prueba'`));

    // 3. Borrar la copia local (con confirmación).
    await pulsar('[data-accion="borrar-local"]');
    await esperar(300);
    comprobar('«Borrar mis respuestas de este navegador» las borra', await evaluar(`window.CUESTIONARIO.estado().empresa.nombre === '' && (localStorage.getItem(${JSON.stringify(CLAVE)}) === null || JSON.parse(localStorage.getItem(${JSON.stringify(CLAVE)})).respuestas.empresa.nombre === '')`));

    // 4. Falla el guardado: error real y descarga disponible.
    servicios.cfg.insertStatus = 500;
    await prepararRespuestas(copia(RESPUESTAS));
    await pulsar('#envio-consentimiento');
    await pulsar('[data-accion="enviar-web"]');
    const errorVisto = await hasta("/No se ha enviado/.test((document.getElementById('envio-estado')||{}).textContent||'')");
    const t4 = await textoEstado();
    comprobar('si falla el guardado: «No se ha enviado» con el mensaje del servidor', errorVisto && /No hemos podido guardar/.test(t4), t4);
    comprobar('… y sigue el botón «Descargar mis respuestas»', await evaluar("!!document.querySelector('[data-accion=\"descargar\"]')"));
    comprobar('… y las respuestas siguen en el navegador', await evaluar(`!!localStorage.getItem(${JSON.stringify(CLAVE)})`));
    comprobar('… y el botón de enviar vuelve a estar disponible', await evaluar("!document.querySelector('[data-accion=\"enviar-web\"]').disabled"));
    servicios.cfg.insertStatus = 201;

    // 5. Privacidad: un teléfono en el texto libre.
    const conTelefono = copia(RESPUESTAS); conTelefono.comentarios = 'Llamadnos al 612 345 678';
    await prepararRespuestas(conTelefono);
    await pulsar('#envio-consentimiento');
    await pulsar('[data-accion="enviar-web"]');
    await hasta("/No se ha enviado/.test((document.getElementById('envio-estado')||{}).textContent||'')");
    comprobar('privacidad: el servidor rechaza el teléfono y el navegador lo explica', /un teléfono en comentarios/.test(await textoEstado()), await textoEstado());

    // 6. Envíos desactivados (como estará hasta revisar los textos legales).
    env.ENVIOS_HABILITADOS = '';
    await prepararRespuestas(copia(RESPUESTAS));
    await pulsar('#envio-consentimiento');
    await pulsar('[data-accion="enviar-web"]');
    await hasta("/No se ha enviado/.test((document.getElementById('envio-estado')||{}).textContent||'')");
    comprobar('con los envíos desactivados, el navegador lo dice y ofrece la descarga', /todavía no está activo/.test(await textoEstado()), await textoEstado());
    env.ENVIOS_HABILITADOS = 'true';

    // 7. Páginas legales y rutas limpias.
    await ir(`${base}/privacidad`);
    comprobar('/privacidad carga el borrador', await evaluar("/Aviso de privacidad/.test(document.body.textContent) && /BORRADOR/.test(document.body.textContent)"));
    await ir(`${base}/aviso-legal`);
    comprobar('/aviso-legal carga el borrador', await evaluar("/Aviso legal/.test(document.body.textContent)"));

    // 8. Abierto como archivo (doble clic): sin envío al servidor, como siempre.
    await prepararRespuestas(RESPUESTAS, pathToFileURL(path.join(RAIZ, 'public', 'robots.txt')).href, pathToFileURL(path.join(RAIZ, 'public', 'index.html')).href);
    comprobar('abierto como archivo: el cuestionario carga y llega a «Revisar y enviar»', await evaluar("/Revisar y enviar/.test(document.body.textContent)"));
    comprobar('abierto como archivo: no ofrece enviar, sí descargar', await evaluar("!document.querySelector('[data-accion=\"enviar-web\"]') && !!document.querySelector('[data-accion=\"descargar\"]')"));

    comprobar('sin errores de JavaScript ni bloqueos de la CSP en la consola', problemasConsola.length === 0, problemasConsola.slice(0, 3).join(' | '));
  } finally {
    cdp.cerrar();
    chrome.kill();
    servidor.close();
    await esperar(300);
    try { fs.rmSync(perfil, { recursive: true, force: true }); } catch { /* Chrome aún cerrando */ }
  }
  const fallos = resultados.filter((r) => !r.ok).length;
  console.log(`\n${resultados.length - fallos}/${resultados.length} comprobaciones en el navegador`);
  process.exit(fallos ? 1 : 0);
}

main().catch((e) => { console.error(`✗ ${e.message}`); process.exit(1); });
