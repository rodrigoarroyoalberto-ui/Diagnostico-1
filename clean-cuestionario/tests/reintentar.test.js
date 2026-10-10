import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reintentar } from '../scripts/reintentar-notificaciones.mjs';
import { serviciosFalsos, entorno, RESPUESTAS, N8N_URL, SECRETO_N8N } from './ayudas.js';

const FILAS = [
  { id: 'aaaaaaaa-0000-4000-8000-000000000001', recibido_en: '2026-10-10T08:00:00Z', empresa: 'Empresa ficticia de prueba', respuestas: RESPUESTAS },
  { id: 'bbbbbbbb-0000-4000-8000-000000000002', recibido_en: '2026-10-10T08:05:00Z', empresa: 'Otra ficticia', respuestas: RESPUESTAS },
];

test('sin --enviar solo lista (no llama a n8n)', async () => {
  const s = serviciosFalsos({ filas: FILAS });
  const r = await reintentar({ env: entorno(), fetch: s.fetch, salida: () => {} });
  assert.equal(r.total, 2);
  assert.equal(s.de(N8N_URL).length, 0);
  const consulta = s.llamadas[0].url;
  assert.match(consulta, /notificacion_estado\.eq\.fallida/);
  assert.doesNotMatch(consulta, /enviada/);
});

test('con --enviar reenvía a n8n autenticado y marca cada resultado', async () => {
  const s = serviciosFalsos({ filas: FILAS });
  const r = await reintentar({ env: entorno(), fetch: s.fetch, enviar: true, salida: () => {} });
  assert.deepEqual(r, { total: 2, enviadas: 2, fallidas: 0 });
  assert.equal(s.de(N8N_URL).length, 2);
  assert.equal(s.de(N8N_URL)[0].cabeceras.Authorization, `Bearer ${SECRETO_N8N}`);
  assert.deepEqual(s.de('marcar_notificacion').map((l) => l.cuerpo.p_estado), ['enviada', 'enviada']);
});

test('si n8n sigue fallando, quedan como fallidas', async () => {
  const s = serviciosFalsos({ filas: FILAS, n8nStatus: 502 });
  const r = await reintentar({ env: entorno(), fetch: s.fetch, enviar: true, salida: () => {} });
  assert.deepEqual(r, { total: 2, enviadas: 0, fallidas: 2 });
  assert.equal(s.de('marcar_notificacion')[0].cuerpo.p_error, 'n8n_http_502');
});

test('sin variables de entorno no hace nada', async () => {
  await assert.rejects(() => reintentar({ env: {}, salida: () => {} }), /Faltan variables/);
});
