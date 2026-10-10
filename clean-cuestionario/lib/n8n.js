/* Aviso a n8n de un diagnóstico ya guardado en Supabase.
 * Autenticación: cabecera `Authorization: Bearer <N8N_WEBHOOK_SECRET>`, que el nodo
 * Webhook de n8n comprueba con una credencial «Header Auth».
 * Solo se envía el diagnóstico (id, fecha, empresa y respuestas): ni claves, ni IP,
 * ni nada más. Un intento por llamada: los reintentos son manuales
 * (scripts/reintentar-notificaciones.mjs). */

const TIEMPO_MAXIMO_MS = 8000;

export function cuerpoNotificacion({ id, recibido_en, empresa, respuestas }) {
  return { evento: 'diagnostico.recibido', id, recibido_en, empresa, respuestas };
}

/* Devuelve { ok: true } o { ok: false, error: 'codigo' }. Nunca lanza. */
export async function notificarN8n({ url, secreto, fetch = globalThis.fetch, tiempoMs = TIEMPO_MAXIMO_MS }, diagnostico) {
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secreto}` },
      body: JSON.stringify(cuerpoNotificacion(diagnostico)),
      signal: AbortSignal.timeout(tiempoMs),
      redirect: 'error',
    });
    // No se lee ni se guarda lo que conteste n8n: solo si ha ido bien.
    try { await r.body?.cancel(); } catch { /* sin cuerpo */ }
    return r.ok ? { ok: true } : { ok: false, error: `n8n_http_${r.status}` };
  } catch (e) {
    return { ok: false, error: e && (e.name === 'TimeoutError' || e.name === 'AbortError') ? 'n8n_timeout' : 'n8n_conexion' };
  }
}
