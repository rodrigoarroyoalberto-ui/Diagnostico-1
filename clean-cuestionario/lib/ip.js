import { createHmac } from 'node:crypto';

/* IP del cliente, solo para limitar la frecuencia de envíos.
 *
 * - En Vercel (VERCEL=1) se usa `x-vercel-forwarded-for` / `x-real-ip`: las pone
 *   la propia plataforma y sustituye lo que mande el cliente, así que no se puede
 *   falsear desde fuera. No se usa el primer valor de `x-forwarded-for`, que sí
 *   puede traer lo que el cliente quiera delante.
 * - Fuera de Vercel (pruebas locales) no se confía en ninguna cabecera: se usa la
 *   dirección de la conexión.
 *
 * La IP nunca se guarda ni se registra: solo su HMAC-SHA256 con un secreto del
 * servidor (IP_HASH_SECRET), que no se puede revertir sin ese secreto.
 */
export function obtenerIp({ cabeceras = {}, direccionSocket = '', enVercel = false }) {
  if (enVercel) {
    const v = cabeceras['x-vercel-forwarded-for'] || cabeceras['x-real-ip'] || '';
    const ip = String(Array.isArray(v) ? v[0] : v).split(',')[0].trim();
    if (ip) return ip;
  }
  return String(direccionSocket || '').trim() || 'desconocida';
}

export function hashIp(ip, secreto) {
  return createHmac('sha256', secreto).update(`ip:${ip}`).digest('hex');
}
