/* Lógica de /api/enviar, separada del adaptador HTTP para poder probarla.
 *
 * Orden: método → envíos activos → configuración → origen → tipo → tamaño → JSON →
 * validación (formato, casilla trampa, campos, consentimiento, privacidad) →
 * límites de frecuencia → guardar en Supabase → avisar a n8n → marcar el aviso.
 * Nada toca la base de datos hasta que el envío es válido. */

import { validarEnvio } from './validar.js';
import { hashIp } from './ip.js';
import { crearSupabase, ErrorServicio } from './supabase.js';
import { notificarN8n } from './n8n.js';

export const TAMANO_MAXIMO = 1_000_000; // bytes

const MENSAJES = {
  metodo: 'Método no permitido.',
  envios_desactivados: 'El envío en línea todavía no está activo. Descarga tus respuestas y mándanoslas por email.',
  no_configurado: 'El envío en línea no está disponible ahora mismo. Descarga tus respuestas y mándanoslas por email.',
  origen: 'Este envío no viene del cuestionario.',
  tipo: 'El envío tiene que ser JSON.',
  tamano: 'Las respuestas ocupan demasiado para enviarlas por aquí. Descárgalas y mándanoslas por email.',
  json: 'El envío está dañado. Vuelve a intentarlo o descarga tus respuestas.',
  limite_ip: 'Se han hecho demasiados envíos desde tu conexión en la última hora. Espera un poco o descarga tus respuestas y mándanoslas por email.',
  limite_global: 'Ahora mismo no podemos recibir más envíos. Descarga tus respuestas y mándanoslas por email.',
  almacenamiento: 'No hemos podido guardar tus respuestas. No se ha enviado nada: descárgalas y mándanoslas por email, o vuelve a intentarlo más tarde.',
};

const error = (status, codigo, mensaje = MENSAJES[codigo], extra = {}) => ({ status, cuerpo: { ok: false, error: codigo, mensaje }, cabeceras: extra });

function origenPermitido(cabeceras, config) {
  const origen = String(cabeceras.origin || '').replace(/\/+$/, '');
  if (!origen) return false;
  const host = String(cabeceras.host || '').trim();
  const permitidos = new Set(config.origenesExtra);
  if (host) {
    permitidos.add(`https://${host}`);
    if (!config.enVercel) permitidos.add(`http://${host}`); // solo pruebas locales
  }
  return permitidos.has(origen);
}

/* entrada: { metodo, cabeceras (en minúsculas), cuerpo (string o null), demasiadoGrande, ip }
   deps:    { config, fetch, log, tiempoN8nMs? }
   devuelve { status, cuerpo, cabeceras } */
export async function procesarEnvio(entrada, { config, fetch = globalThis.fetch, log = () => {}, tiempoN8nMs }) {
  const { metodo, cabeceras = {}, cuerpo, demasiadoGrande, ip } = entrada;

  if (metodo !== 'POST') return error(405, 'metodo', undefined, { Allow: 'POST' });
  if (!config.enviosHabilitados) return error(503, 'envios_desactivados');
  if (config.problemas.length) {
    log({ evento: 'configuracion_incompleta', faltan: config.problemas });
    return error(503, 'no_configurado');
  }
  if (!origenPermitido(cabeceras, config)) return error(403, 'origen');
  if (!/^application\/json\b/i.test(String(cabeceras['content-type'] || ''))) return error(415, 'tipo');
  if (demasiadoGrande || cuerpo == null || Buffer.byteLength(cuerpo) > TAMANO_MAXIMO) return error(413, 'tamano');

  let sobre;
  try { sobre = JSON.parse(cuerpo); } catch { return error(400, 'json'); }

  const v = validarEnvio(sobre);
  if (!v.ok) {
    if (v.codigo === 'control') log({ evento: 'rechazado_control' });
    return error(v.codigo === 'formato' || v.codigo === 'control' ? 400 : 422, v.codigo, v.mensaje);
  }

  const db = crearSupabase({ url: config.supabaseUrl, clave: config.supabaseClave, fetch });

  try {
    if (!(await db.registrarIntento(`ip:${hashIp(ip, config.ipSecreto)}`, config.limitePorIpHora, 3600))) return error(429, 'limite_ip', undefined, { 'Retry-After': '3600' });
    if (!(await db.registrarIntento('global', config.limiteGlobalDia, 86400))) {
      log({ evento: 'limite_global_alcanzado' });
      return error(429, 'limite_global');
    }
  } catch (e) {
    log({ evento: 'limite_error', error: e instanceof ErrorServicio ? e.codigo : 'desconocido' });
    return error(503, 'almacenamiento');
  }

  let fila;
  try {
    fila = await db.insertarDiagnostico({
      empresa: v.empresa,
      version_formulario: typeof v.respuestas.version_formulario === 'string' ? v.respuestas.version_formulario.slice(0, 20) : null,
      respuestas: v.respuestas,
      consentimiento_aceptado: true,
      consentimiento_version: config.versionAviso,
    });
  } catch (e) {
    log({ evento: 'guardar_error', error: e instanceof ErrorServicio ? e.codigo : 'desconocido' });
    return error(503, 'almacenamiento');
  }
  log({ evento: 'diagnostico_guardado', id: fila.id });

  // Ya está guardado: pase lo que pase con n8n, el cliente recibe «Recibido».
  const aviso = await notificarN8n({ url: config.n8nUrl, secreto: config.n8nSecreto, fetch, tiempoMs: tiempoN8nMs }, { id: fila.id, recibido_en: fila.recibido_en, empresa: v.empresa, respuestas: v.respuestas });
  if (!aviso.ok) log({ evento: 'notificacion_fallida', id: fila.id, error: aviso.error });
  try {
    await db.marcarNotificacion(fila.id, aviso.ok ? 'enviada' : 'fallida', aviso.ok ? null : aviso.error);
  } catch (e) {
    // Queda como «pendiente»: scripts/reintentar-notificaciones.mjs la recoge.
    log({ evento: 'marcar_notificacion_error', id: fila.id, error: e instanceof ErrorServicio ? e.codigo : 'desconocido' });
  }

  return { status: 201, cuerpo: { ok: true, referencia: fila.id.slice(0, 8).toUpperCase() }, cabeceras: {} };
}
