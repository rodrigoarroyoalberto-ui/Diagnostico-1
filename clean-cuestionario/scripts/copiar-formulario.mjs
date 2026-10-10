/* Copia el cuestionario generado por el kit a public/index.html.
 *
 *   node scripts/copiar-formulario.mjs [ruta al formulario.html del kit]
 *
 * Por defecto busca ../kit-diagnostico-procesos/kit-diagnostico-procesos/formulario/formulario.html
 * (o la ruta de la variable KIT_FORMULARIO). Antes, en el kit: node herramientas/formulario.mjs
 * El HTML no se edita a mano: si hay que cambiar algo, se cambia en el kit y se vuelve a copiar. */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { comprobarFormulario } from './comprobar-despliegue.mjs';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const origen = path.resolve(process.argv[2] || process.env.KIT_FORMULARIO || path.join(RAIZ, '..', 'kit-diagnostico-procesos', 'kit-diagnostico-procesos', 'formulario', 'formulario.html'));
const destino = path.join(RAIZ, 'public', 'index.html');

if (!fs.existsSync(origen)) {
  console.error(`✗ No encuentro el cuestionario del kit en ${origen}`);
  console.error('  Genera el cuestionario en el kit (node herramientas/formulario.mjs) o pasa la ruta como argumento.');
  process.exit(1);
}
const html = fs.readFileSync(origen, 'utf8');
const problemas = comprobarFormulario(html);
if (problemas.length) {
  console.error('✗ Ese cuestionario no está preparado para publicarse:');
  for (const p of problemas) console.error(`  - ${p}`);
  process.exit(1);
}
fs.writeFileSync(destino, html);
console.log(`✓ Copiado a public/index.html (${Math.round(Buffer.byteLength(html) / 1024)} KB)`);
