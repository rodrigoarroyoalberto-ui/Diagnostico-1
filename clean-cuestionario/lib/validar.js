/* Validación del envío del cuestionario.
 *
 * El navegador manda un sobre:
 *   { formato_envio: 'envio-diagnostico/1', respuestas: {...}, consentimiento: true, control: '' }
 * `respuestas` es exactamente el archivo que descarga el cuestionario
 * (formato 'respuestas-diagnostico/1'), para que el kit lo lea igual.
 * `control` es una casilla invisible: una persona la deja vacía.
 */

import { buscarDatosSensibles, dondeEnCristiano } from './privacidad.js';

export const FORMATO_ENVIO = 'envio-diagnostico/1';
export const FORMATO_RESPUESTAS = 'respuestas-diagnostico/1';
const PROFUNDIDAD_MAXIMA = 12;
const TEXTO_MAXIMO = 20000;

const esObjeto = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const texto = (v) => (typeof v === 'string' ? v.trim() : '');
export const emailValido = (t) => typeof t === 'string' && t.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t.trim());

function estructuraRazonable(v, nivel = 0) {
  if (nivel > PROFUNDIDAD_MAXIMA) return false;
  if (typeof v === 'string') return v.length <= TEXTO_MAXIMO;
  if (Array.isArray(v)) return v.every((x) => estructuraRazonable(x, nivel + 1));
  if (esObjeto(v)) return Object.values(v).every((x) => estructuraRazonable(x, nivel + 1));
  return v === null || typeof v === 'number' || typeof v === 'boolean';
}

/* Devuelve { ok: true, respuestas, empresa } o { ok: false, codigo, mensaje, detalles? }.
   Los mensajes son para la persona que rellena: nunca repiten lo que escribió. */
export function validarEnvio(sobre) {
  if (!esObjeto(sobre) || sobre.formato_envio !== FORMATO_ENVIO) {
    return { ok: false, codigo: 'formato', mensaje: 'El envío no tiene el formato del cuestionario.' };
  }
  if (sobre.control !== undefined && sobre.control !== '') {
    return { ok: false, codigo: 'control', mensaje: 'No se ha podido validar el envío. Descarga tus respuestas y mándanoslas por email.' };
  }
  const r = sobre.respuestas;
  if (!esObjeto(r) || r.formato !== FORMATO_RESPUESTAS || !esObjeto(r.areas) || !esObjeto(r.empresa) || !esObjeto(r.respondente)) {
    return { ok: false, codigo: 'formato', mensaje: 'Las respuestas no tienen el formato del cuestionario.' };
  }
  if (!estructuraRazonable(r)) {
    return { ok: false, codigo: 'formato', mensaje: 'Las respuestas son demasiado largas o tienen una estructura no válida.' };
  }
  const faltan = [];
  const empresa = texto(r.empresa.nombre);
  if (!empresa || empresa.length > 200) faltan.push('el nombre de la empresa');
  const nombre = texto(r.respondente.nombre);
  if (!nombre || nombre.length > 200) faltan.push('tu nombre');
  if (!emailValido(r.respondente.email)) faltan.push('un email de contacto válido');
  if (faltan.length) {
    return { ok: false, codigo: 'campos', mensaje: `Falta ${faltan.join(', ')}.` };
  }
  if (sobre.consentimiento !== true) {
    return { ok: false, codigo: 'consentimiento', mensaje: 'Para enviarlo tienes que aceptar el aviso de privacidad.' };
  }
  const sensibles = buscarDatosSensibles(r);
  if (sensibles.length) {
    const detalles = sensibles.slice(0, 8).map((h) => `${h.tipo} en ${dondeEnCristiano(h.ruta)}`);
    return {
      ok: false,
      codigo: 'privacidad',
      mensaje: `Tus respuestas incluyen datos que no necesitamos y no podemos recibir (correos, teléfonos, cuentas, DNI, tarjetas o contraseñas). Quítalos y vuelve a enviar: ${detalles.join('; ')}${sensibles.length > 8 ? '…' : '.'}`,
      detalles,
    };
  }
  return { ok: true, respuestas: r, empresa };
}
