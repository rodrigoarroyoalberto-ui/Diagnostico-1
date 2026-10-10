/* Acceso a Supabase por su API REST (PostgREST), sin dependencias.
 * Solo se usa en el servidor, con la clave secreta (SUPABASE_SECRET_KEY).
 * Los errores llevan solo un código técnico: nunca el cuerpo de la respuesta,
 * que podría repetir datos del diagnóstico. */

export class ErrorServicio extends Error {
  constructor(codigo) { super(codigo); this.codigo = codigo; }
}

const TIEMPO_MAXIMO_MS = 8000;

export function crearSupabase({ url, clave, fetch = globalThis.fetch, tiempoMs = TIEMPO_MAXIMO_MS }) {
  const cabeceras = { apikey: clave, 'Content-Type': 'application/json', Accept: 'application/json' };
  // Las claves antiguas (service_role) son JWT y van también en Authorization.
  // Las nuevas (sb_secret_…) van solo en apikey.
  if (clave.startsWith('eyJ')) cabeceras.Authorization = `Bearer ${clave}`;

  async function pedir(ruta, { metodo = 'GET', cuerpo, extra = {} } = {}) {
    let r;
    try {
      r = await fetch(`${url}${ruta}`, {
        method: metodo,
        headers: { ...cabeceras, ...extra },
        body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
        signal: AbortSignal.timeout(tiempoMs),
      });
    } catch (e) {
      throw new ErrorServicio(e && (e.name === 'TimeoutError' || e.name === 'AbortError') ? 'supabase_timeout' : 'supabase_conexion');
    }
    if (!r.ok) throw new ErrorServicio(`supabase_http_${r.status}`);
    const t = await r.text();
    try { return t ? JSON.parse(t) : null; } catch { throw new ErrorServicio('supabase_respuesta'); }
  }

  return {
    /* true si el intento cabe en el límite (y queda registrado); false si lo supera. */
    async registrarIntento(clave, maximo, ventanaSegundos) {
      const ok = await pedir('/rest/v1/rpc/registrar_intento_envio', { metodo: 'POST', cuerpo: { p_clave: clave, p_max: maximo, p_ventana_segundos: ventanaSegundos } });
      if (typeof ok !== 'boolean') throw new ErrorServicio('supabase_respuesta');
      return ok;
    },
    async insertarDiagnostico(fila) {
      const d = await pedir('/rest/v1/diagnosticos?select=id,recibido_en', { metodo: 'POST', cuerpo: fila, extra: { Prefer: 'return=representation' } });
      const f = Array.isArray(d) ? d[0] : d;
      if (!f || typeof f.id !== 'string') throw new ErrorServicio('supabase_respuesta');
      return f;
    },
    async marcarNotificacion(id, estado, error = null) {
      await pedir('/rest/v1/rpc/marcar_notificacion', { metodo: 'POST', cuerpo: { p_id: id, p_estado: estado, p_error: error } });
    },
    /* Fallidas, o pendientes desde hace más de `minutos` (la función se cortó a medias). */
    async listarPorNotificar({ limite = 20, minutos = 10, ahora = new Date() } = {}) {
      const corte = new Date(ahora.getTime() - minutos * 60000).toISOString();
      const filtro = `or=(notificacion_estado.eq.fallida,and(notificacion_estado.eq.pendiente,recibido_en.lt.${encodeURIComponent(corte)}))`;
      return pedir(`/rest/v1/diagnosticos?select=id,recibido_en,empresa,respuestas&${filtro}&order=recibido_en.asc&limit=${limite}`);
    },
  };
}
