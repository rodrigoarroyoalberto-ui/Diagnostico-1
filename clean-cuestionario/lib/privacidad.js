/* Reglas de privacidad del kit de diagnóstico.
 *
 * Son los mismos patrones y las mismas exclusiones que herramientas/borrador.mjs
 * del kit: si cambian allí, hay que cambiarlos aquí. El cuestionario pregunta cómo
 * se trabaja, no por datos: correos, teléfonos, cuentas, DNI, tarjetas o
 * contraseñas en el texto libre no deben llegar al servidor.
 *
 * Diferencia con el kit: aquí nunca se devuelve ni se registra el dato encontrado
 * (ni siquiera una muestra), solo el tipo y dónde está.
 */

export const PATRONES = [
  { nombre: 'un correo electrónico', re: /[\w.+-]+@[\w-]+\.[\w.-]+/g },
  { nombre: 'un teléfono', re: /(?:\+\d{1,3}[\s.-]?)?(?:\d[\s.-]?){8,13}\d/g, filtro: (m) => { const d = m.replace(/\D/g, ''); return d.length >= 9 && d.length <= 15 && !/^20\d{6}$/.test(d); } },
  { nombre: 'una cuenta bancaria (IBAN)', re: /\b[A-Z]{2}\d{2}(?:[\s]?[\dA-Z]{4}){4,7}\b/g },
  { nombre: 'un DNI/NIE', re: /\b(?:\d{8}|[XYZ]\d{7})[-\s]?[A-Z]\b/g },
  { nombre: 'un número de tarjeta', re: /\b(?:\d[ -]?){13,16}\b/g, filtro: (m) => m.replace(/\D/g, '').length >= 13 },
  { nombre: 'una contraseña', re: /(contrase[ñn]a|password|clave)\s*[:=]\s*\S+/gi },
];

/* Recorre el texto libre de las respuestas (no los datos de contacto de quien
   rellena ni la web de la empresa) y devuelve [{ ruta, tipo }]. */
export function buscarDatosSensibles(respuestas) {
  const hallazgos = [];
  const recorrer = (v, ruta) => {
    if (typeof v === 'string') {
      for (const p of PATRONES) {
        for (const m of v.match(p.re) || []) {
          if (p.filtro && !p.filtro(m)) continue;
          hallazgos.push({ ruta, tipo: p.nombre });
        }
      }
    } else if (Array.isArray(v)) v.forEach((x, i) => recorrer(x, `${ruta}[${i}]`));
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) if (!k.startsWith('_')) recorrer(x, ruta ? `${ruta}.${k}` : k);
  };
  const { respondente, fuentes, empresa, ...resto } = respuestas || {};
  const { web_dominio, ...empresaSinWeb } = empresa || {};
  recorrer(empresaSinWeb, 'empresa');
  recorrer(resto, '');
  return hallazgos;
}

const AREAS = { marketing: 'Marketing', ventas: 'Ventas', fulfillment: 'Fulfillment', administracion: 'Administración' };
const CAMPOS = { como: 'cómo se hace', dolor: 'qué falla', que: 'qué se hace', nombre: 'nombre', notas: 'notas', excepciones: 'excepciones', caso_complicado: 'caso complicado', ultimo_caso: 'último caso', otros_finales: 'otros finales', resultado: 'cómo termina', texto: 'texto', comentarios: 'comentarios', uso: 'para qué la usáis', molestia: 'lo que molesta', que_hace: 'qué hace' };

/* «areas.ventas.procesos[0].pasos[2].como» → «Ventas · proceso 1 · paso 3 · cómo se hace».
   Sin citar el texto del cliente. */
export function dondeEnCristiano(ruta) {
  const m = ruta.match(/^areas\.(\w+)\.procesos\[(\d+)\](?:\.pasos\[(\d+)\])?(?:\.(.+))?$/);
  if (!m) {
    const campo = ruta.replace(/^\./, '').split('.').pop().replace(/\[\d+\]$/, '');
    const seccion = ruta.replace(/^\./, '').split(/[.[]/)[0];
    return [seccion, CAMPOS[campo] && campo !== seccion ? CAMPOS[campo] : ''].filter(Boolean).join(' · ');
  }
  const partes = [AREAS[m[1]] || m[1], `proceso ${+m[2] + 1}`];
  if (m[3] !== undefined) partes.push(`paso ${+m[3] + 1}`);
  const campo = (m[4] || '').split('.').pop();
  if (campo) partes.push(CAMPOS[campo] || campo);
  return partes.join(' · ');
}
