/* Utilidades de las pruebas. Supabase y n8n se SIMULAN aquí: las pruebas no se
 * conectan a ningún servicio real ni usan credenciales reales. */

import fs from 'node:fs';
import { Readable } from 'node:stream';
import handler from '../api/enviar.js';

export const RESPUESTAS = JSON.parse(fs.readFileSync(new URL('./fixtures/ejemplo-ficticio.json', import.meta.url), 'utf8'));
export const copia = (x) => JSON.parse(JSON.stringify(x));

export const SUPABASE_URL = 'https://proyecto-de-prueba.supabase.co';
export const N8N_URL = 'https://n8n.example.com/webhook/diagnostico';
export const SECRETO_N8N = 'secreto-de-prueba-n8n-0123456789abcdef';
export const CLAVE_SUPABASE = 'sb_secret_clave-de-prueba-no-real';

export function entorno(extra = {}) {
  return {
    ENVIOS_HABILITADOS: 'true',
    AVISO_PRIVACIDAD_VERSION: 'prueba-1',
    SUPABASE_URL,
    SUPABASE_SECRET_KEY: CLAVE_SUPABASE,
    N8N_WEBHOOK_URL: N8N_URL,
    N8N_WEBHOOK_SECRET: SECRETO_N8N,
    IP_HASH_SECRET: 'secreto-de-prueba-ip-0123456789abcdef',
    ...extra,
  };
}

export function sobre(cambios = {}) {
  return { formato_envio: 'envio-diagnostico/1', respuestas: copia(RESPUESTAS), consentimiento: true, control: '', ...cambios };
}

/* fetch falso: Supabase (rpc e insert) y n8n, configurable por prueba. */
export function serviciosFalsos(o = {}) {
  const llamadas = [];
  const cfg = { limiteIp: true, limiteGlobal: true, rpcStatus: 200, insertStatus: 201, marcarStatus: 204, n8nStatus: 200, n8nCuelga: false, ...o };
  const resp = (status, cuerpo) => new Response(cuerpo === undefined ? null : JSON.stringify(cuerpo), { status, headers: { 'Content-Type': 'application/json' } });
  const fetch = async (url, op = {}) => {
    const cuerpo = op.body ? JSON.parse(op.body) : undefined;
    llamadas.push({ url: String(url), metodo: op.method, cabeceras: op.headers || {}, cuerpo });
    const u = new URL(url);
    if (String(url).startsWith(N8N_URL)) {
      if (cfg.n8nCuelga) {
        // Como una conexión real que no contesta: mantiene vivo el proceso hasta que se corta.
        return new Promise((_, rechazar) => {
          const abierta = setTimeout(() => {}, 60000);
          op.signal.addEventListener('abort', () => { clearTimeout(abierta); rechazar(op.signal.reason); });
        });
      }
      return resp(cfg.n8nStatus, { recibido: true });
    }
    if (u.pathname === '/rest/v1/rpc/registrar_intento_envio') {
      if (cfg.rpcStatus !== 200) return resp(cfg.rpcStatus, { message: 'error interno con datos' });
      return resp(200, cuerpo.p_clave === 'global' ? cfg.limiteGlobal : cfg.limiteIp);
    }
    if (u.pathname === '/rest/v1/diagnosticos' && op.method === 'POST') {
      if (cfg.insertStatus !== 201) return resp(cfg.insertStatus, { message: `fallo con ${cuerpo.empresa}` });
      return resp(201, [{ id: '3f2a9c1e-0000-4000-8000-000000000001', recibido_en: '2026-10-10T10:00:00.000Z' }]);
    }
    if (u.pathname === '/rest/v1/rpc/marcar_notificacion') return resp(cfg.marcarStatus);
    if (u.pathname === '/rest/v1/diagnosticos' && op.method === 'GET') return resp(200, cfg.filas || []);
    return resp(404, {});
  };
  const de = (fragmento) => llamadas.filter((l) => l.url.includes(fragmento));
  return { fetch, llamadas, de, cfg };
}

/* Llama al handler real de api/enviar.js con una petición simulada. */
export async function llamar({ metodo = 'POST', cuerpo, cabeceras = {}, env = entorno(), servicios = serviciosFalsos(), ip = '203.0.113.7', tiempoN8nMs = 50 } = {}) {
  const texto = cuerpo === undefined ? '' : typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo);
  const req = Readable.from(texto ? [Buffer.from(texto)] : []);
  req.method = metodo;
  req.headers = { host: 'cuestionario.example.com', origin: 'https://cuestionario.example.com', 'content-type': 'application/json', ...cabeceras };
  req.socket = { remoteAddress: ip };
  const res = { statusCode: 0, cabeceras: {}, cuerpo: '', setHeader(k, v) { this.cabeceras[k.toLowerCase()] = v; }, end(t) { this.cuerpo = t || ''; } };
  const registros = [];
  await handler(req, res, { env, fetch: servicios.fetch, tiempoN8nMs, log: (d) => registros.push(d) });
  let json = null;
  try { json = JSON.parse(res.cuerpo); } catch { /* sin JSON */ }
  return { status: res.statusCode, json, cabeceras: res.cabeceras, servicios, registros, texto: res.cuerpo };
}
