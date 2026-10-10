/* POST /api/enviar — recibe el cuestionario, lo valida, lo guarda en Supabase y
 * avisa a n8n. Toda la lógica está en lib/procesar.js; aquí solo se adapta la
 * petición HTTP de Vercel (Node.js) y se lee el cuerpo con un tope de tamaño. */

import { procesarEnvio, TAMANO_MAXIMO } from '../lib/procesar.js';
import { leerConfig } from '../lib/config.js';
import { obtenerIp } from '../lib/ip.js';

/* Lee el cuerpo sin pasar de `maximo` bytes. Devuelve { texto, demasiadoGrande }. */
export async function leerCuerpo(req, maximo = TAMANO_MAXIMO) {
  const declarado = Number(req.headers['content-length']);
  if (Number.isFinite(declarado) && declarado > maximo) return { texto: null, demasiadoGrande: true };
  const trozos = [];
  let total = 0;
  for await (const t of req) {
    total += t.length;
    if (total > maximo) return { texto: null, demasiadoGrande: true };
    trozos.push(typeof t === 'string' ? Buffer.from(t) : t);
  }
  let b = null;
  if (total === 0) { try { b = req.body; } catch { b = null; } }
  if (b != null && b !== '') {
    // Por si la plataforma ya hubiera leído el cuerpo antes que nosotros.
    const texto = Buffer.isBuffer(b) ? b.toString('utf8') : typeof b === 'string' ? b : JSON.stringify(b);
    return Buffer.byteLength(texto) > maximo ? { texto: null, demasiadoGrande: true } : { texto, demasiadoGrande: false };
  }
  return { texto: Buffer.concat(trozos).toString('utf8'), demasiadoGrande: false };
}

/* Registro sin datos personales: solo eventos, ids y códigos. */
const logConsola = (dato) => console.log(JSON.stringify({ origen: 'api/enviar', ...dato }));

export default async function handler(req, res, { env = process.env, fetch = globalThis.fetch, tiempoN8nMs, log = logConsola } = {}) {
  const config = leerConfig(env);
  let resultado;
  try {
    const metodo = req.method;
    const { texto, demasiadoGrande } = metodo === 'POST' ? await leerCuerpo(req) : { texto: null, demasiadoGrande: false };
    const ip = obtenerIp({ cabeceras: req.headers, direccionSocket: req.socket?.remoteAddress, enVercel: config.enVercel });
    resultado = await procesarEnvio({ metodo, cabeceras: req.headers, cuerpo: texto, demasiadoGrande, ip }, { config, fetch, log, tiempoN8nMs });
  } catch (e) {
    log({ evento: 'error_inesperado', error: e && e.name ? e.name : 'desconocido' });
    resultado = { status: 500, cuerpo: { ok: false, error: 'interno', mensaje: 'Ha fallado algo en el servidor. Descarga tus respuestas y mándanoslas por email.' }, cabeceras: {} };
  }
  res.statusCode = resultado.status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  for (const [k, v] of Object.entries(resultado.cabeceras || {})) res.setHeader(k, v);
  res.end(JSON.stringify(resultado.cuerpo));
}
