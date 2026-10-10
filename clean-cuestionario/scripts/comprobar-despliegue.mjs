/* Comprobaciones antes de publicar. Es el «build» de Vercel (npm run build):
 * si algo falla, Vercel no publica.
 *
 * - public/index.html es el cuestionario del kit con el bloque de envío al servidor.
 * - Están el aviso de privacidad y el aviso legal.
 * - Si ENVIOS_HABILITADOS=true, los textos legales no pueden tener [POR COMPLETAR]
 *   y tiene que estar AVISO_PRIVACIDAD_VERSION.
 * - Nada que parezca una clave en public/. */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLICO = path.join(RAIZ, 'public');
const LEGALES = ['privacidad.html', 'aviso-legal.html'];

export const PATRONES_SECRETO = [
  { nombre: 'clave secreta de Supabase', re: /sb_secret_[A-Za-z0-9_-]{10,}/ },
  { nombre: 'JWT (posible clave service_role)', re: /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/ },
  { nombre: 'variable de entorno con valor', re: /(SUPABASE_SECRET_KEY|N8N_WEBHOOK_SECRET|IP_HASH_SECRET)[ \t]*=[ \t]*[^\s'"`]{8,}/ },
  { nombre: 'clave privada', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
];

export function comprobarFormulario(html) {
  const p = [];
  if (!html.includes('ENVIO_SERVIDOR v1')) p.push('No tiene el bloque de envío al servidor (ENVIO_SERVIDOR v1): regenera el cuestionario con la plantilla actualizada del kit.');
  if (!html.includes('"webhook_formulario":"/api/enviar"')) p.push('La dirección de envío no es /api/enviar: pon "webhook_formulario": "/api/enviar" en marca/marca.json del kit y regenera.');
  if (!/<meta name="robots" content="noindex">/.test(html)) p.push('Falta <meta name="robots" content="noindex">.');
  return p;
}

export function buscarSecretos(texto) {
  return PATRONES_SECRETO.filter((s) => s.re.test(texto)).map((s) => s.nombre);
}

export function comprobarDespliegue({ env = process.env, publico = PUBLICO } = {}) {
  const errores = [];
  const avisos = [];
  const indice = path.join(publico, 'index.html');
  if (!fs.existsSync(indice)) errores.push('Falta public/index.html (node scripts/copiar-formulario.mjs).');
  else errores.push(...comprobarFormulario(fs.readFileSync(indice, 'utf8')));

  for (const f of LEGALES) {
    const ruta = path.join(publico, f);
    if (!fs.existsSync(ruta)) { errores.push(`Falta public/${f}.`); continue; }
    const t = fs.readFileSync(ruta, 'utf8');
    if (t.includes('[POR COMPLETAR]')) {
      if (env.ENVIOS_HABILITADOS === 'true') errores.push(`public/${f} tiene [POR COMPLETAR] y ENVIOS_HABILITADOS=true: completa y revisa los textos legales antes de activar los envíos.`);
      else avisos.push(`public/${f} es un borrador ([POR COMPLETAR]). Los envíos siguen desactivados.`);
    }
  }
  if (env.ENVIOS_HABILITADOS === 'true' && !env.AVISO_PRIVACIDAD_VERSION) errores.push('ENVIOS_HABILITADOS=true sin AVISO_PRIVACIDAD_VERSION.');

  for (const f of fs.existsSync(publico) ? fs.readdirSync(publico) : []) {
    const s = buscarSecretos(fs.readFileSync(path.join(publico, f), 'utf8'));
    if (s.length) errores.push(`public/${f} parece contener: ${s.join(', ')}.`);
  }
  return { errores, avisos };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { errores, avisos } = comprobarDespliegue();
  for (const a of avisos) console.log(`! ${a}`);
  if (errores.length) {
    for (const e of errores) console.error(`✗ ${e}`);
    process.exit(1);
  }
  console.log('✓ Listo para publicar.');
}
