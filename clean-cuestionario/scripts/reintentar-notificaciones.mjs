/* Reintento MANUAL de avisos a n8n que fallaron (o se quedaron a medias).
 *
 *   node --env-file=.env.local scripts/reintentar-notificaciones.mjs          → solo lista
 *   node --env-file=.env.local scripts/reintentar-notificaciones.mjs --enviar → reenvía
 *
 * Usa SUPABASE_URL, SUPABASE_SECRET_KEY, N8N_WEBHOOK_URL y N8N_WEBHOOK_SECRET.
 * No hay reintentos automáticos: esto se lanza a mano cuando la vista
 * diagnosticos_por_notificar muestra filas. */

import { pathToFileURL } from 'node:url';
import { crearSupabase } from '../lib/supabase.js';
import { notificarN8n } from '../lib/n8n.js';

export async function reintentar({ env = process.env, fetch = globalThis.fetch, enviar = false, salida = console.log } = {}) {
  const faltan = ['SUPABASE_URL', 'SUPABASE_SECRET_KEY', 'N8N_WEBHOOK_URL', 'N8N_WEBHOOK_SECRET'].filter((k) => !env[k]);
  if (faltan.length) throw new Error(`Faltan variables de entorno: ${faltan.join(', ')}`);
  const db = crearSupabase({ url: env.SUPABASE_URL.replace(/\/+$/, ''), clave: env.SUPABASE_SECRET_KEY, fetch });
  const filas = await db.listarPorNotificar();
  salida(`${filas.length} diagnóstico(s) con aviso pendiente o fallido.`);
  const resultado = { total: filas.length, enviadas: 0, fallidas: 0 };
  for (const f of filas) {
    if (!enviar) { salida(`  - ${f.id.slice(0, 8).toUpperCase()} · ${f.recibido_en}`); continue; }
    const r = await notificarN8n({ url: env.N8N_WEBHOOK_URL, secreto: env.N8N_WEBHOOK_SECRET, fetch }, f);
    await db.marcarNotificacion(f.id, r.ok ? 'enviada' : 'fallida', r.ok ? null : r.error);
    if (r.ok) resultado.enviadas++; else resultado.fallidas++;
    salida(`  ${r.ok ? '✓' : '✗'} ${f.id.slice(0, 8).toUpperCase()}${r.ok ? '' : ` (${r.error})`}`);
  }
  if (!enviar && filas.length) salida('Para reenviarlos: añade --enviar.');
  return resultado;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  reintentar({ enviar: process.argv.includes('--enviar') }).catch((e) => { console.error(`✗ ${e.message}`); process.exit(1); });
}
