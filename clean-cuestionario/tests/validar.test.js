import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validarEnvio } from '../lib/validar.js';
import { buscarDatosSensibles, dondeEnCristiano } from '../lib/privacidad.js';
import { leerConfig } from '../lib/config.js';
import { sobre, entorno, RESPUESTAS, copia } from './ayudas.js';

test('un envío completo del cuestionario es válido', () => {
  const v = validarEnvio(sobre());
  assert.equal(v.ok, true);
  assert.equal(v.empresa, 'Empresa ficticia de prueba');
});

test('el ejemplo ficticio no dispara las reglas de privacidad del kit', () => {
  assert.deepEqual(buscarDatosSensibles(RESPUESTAS), []);
});

test('fechas y años no se confunden con teléfonos', () => {
  const r = copia(RESPUESTAS);
  r.comentarios = 'Empezamos en 2019 y facturamos unos 20240101 céntimos';
  assert.deepEqual(buscarDatosSensibles(r), []);
});

test('detecta DNI y tarjeta, sin devolver el dato', () => {
  const r = copia(RESPUESTAS);
  r.equipo[0].rol = 'Recepción 12345678Z';
  r.herramientas[0].molestia = 'pagamos con 4111 1111 1111 1111';
  const h = buscarDatosSensibles(r);
  assert.ok(h.some((x) => x.tipo === 'un DNI/NIE' && x.ruta === 'equipo[0].rol'));
  assert.ok(h.some((x) => x.tipo === 'un número de tarjeta'));
  assert.doesNotMatch(JSON.stringify(h), /12345678|4111/);
});

test('rutas en cristiano', () => {
  assert.equal(dondeEnCristiano('areas.administracion.procesos[1].pasos[0].dolor'), 'Administración · proceso 2 · paso 1 · qué falla');
  assert.equal(dondeEnCristiano('comentarios'), 'comentarios');
  assert.equal(dondeEnCristiano('herramientas[0].molestia'), 'herramientas · lo que molesta');
});

test('estructura excesiva o tipos raros', () => {
  let anidado = {}; const raiz = anidado;
  for (let i = 0; i < 20; i++) { anidado.a = {}; anidado = anidado.a; }
  const s = sobre(); s.respuestas.extra = raiz;
  assert.equal(validarEnvio(s).ok, false);
  const s2 = sobre(); s2.respuestas.comentarios = 'x'.repeat(20001);
  assert.equal(validarEnvio(s2).ok, false);
  assert.equal(validarEnvio(null).ok, false);
  assert.equal(validarEnvio([]).ok, false);
});

test('consentimiento: solo vale true (no "true" ni 1)', () => {
  assert.equal(validarEnvio(sobre({ consentimiento: 'true' })).codigo, 'consentimiento');
  assert.equal(validarEnvio(sobre({ consentimiento: 1 })).codigo, 'consentimiento');
});

test('configuración: exige https y secretos largos; http solo en localhost', () => {
  assert.deepEqual(leerConfig(entorno()).problemas, []);
  const c = leerConfig(entorno({ SUPABASE_URL: 'http://proyecto.supabase.co', N8N_WEBHOOK_URL: 'nada', IP_HASH_SECRET: 'x' }));
  assert.ok(c.problemas.includes('SUPABASE_URL'));
  assert.ok(c.problemas.includes('N8N_WEBHOOK_URL'));
  assert.ok(c.problemas.some((p) => p.startsWith('IP_HASH_SECRET')));
  assert.deepEqual(leerConfig(entorno({ SUPABASE_URL: 'http://127.0.0.1:54321' })).problemas, []);
  assert.equal(leerConfig(entorno({ ENVIOS_HABILITADOS: 'TRUE' })).enviosHabilitados, false);
});
