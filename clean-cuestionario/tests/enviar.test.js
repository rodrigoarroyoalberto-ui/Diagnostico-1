import { test } from 'node:test';
import assert from 'node:assert/strict';
import { llamar, sobre, entorno, serviciosFalsos, copia, RESPUESTAS, SECRETO_N8N, CLAVE_SUPABASE, N8N_URL } from './ayudas.js';
import { hashIp } from '../lib/ip.js';

const SIN_DB = (r) => assert.equal(r.servicios.llamadas.length, 0, 'no debe tocar Supabase ni n8n');

test('solo acepta POST', async () => {
  const r = await llamar({ metodo: 'GET' });
  assert.equal(r.status, 405);
  assert.equal(r.cabeceras.allow, 'POST');
  SIN_DB(r);
});

test('con los envíos desactivados no guarda nada', async () => {
  const r = await llamar({ cuerpo: sobre(), env: entorno({ ENVIOS_HABILITADOS: '' }) });
  assert.equal(r.status, 503);
  assert.equal(r.json.error, 'envios_desactivados');
  SIN_DB(r);
});

test('sin configuración completa responde 503 y registra qué falta, sin valores', async () => {
  const r = await llamar({ cuerpo: sobre(), env: entorno({ SUPABASE_SECRET_KEY: '', N8N_WEBHOOK_SECRET: 'corto' }) });
  assert.equal(r.status, 503);
  assert.equal(r.json.error, 'no_configurado');
  const reg = JSON.stringify(r.registros);
  assert.match(reg, /SUPABASE_SECRET_KEY/);
  assert.doesNotMatch(reg, /corto/);
  SIN_DB(r);
});

test('rechaza peticiones de otro origen o sin origen', async () => {
  for (const origin of ['https://otra-web.example', undefined]) {
    const cab = origin ? { origin } : { origin: '' };
    const r = await llamar({ cuerpo: sobre(), cabeceras: cab });
    assert.equal(r.status, 403);
    assert.equal(r.cabeceras['access-control-allow-origin'], undefined, 'sin CORS abierto');
    SIN_DB(r);
  }
});

test('acepta un origen extra configurado', async () => {
  const r = await llamar({ cuerpo: sobre(), cabeceras: { origin: 'https://diagnostico.example.org' }, env: entorno({ ORIGENES_PERMITIDOS: 'https://diagnostico.example.org' }) });
  assert.equal(r.status, 201);
});

test('exige JSON', async () => {
  const r = await llamar({ cuerpo: sobre(), cabeceras: { 'content-type': 'text/plain' } });
  assert.equal(r.status, 415);
  SIN_DB(r);
});

test('limita el tamaño: por cabecera y por lo que realmente llega', async () => {
  const grande = await llamar({ cuerpo: sobre(), cabeceras: { 'content-length': String(2_000_000) } });
  assert.equal(grande.status, 413);
  const s = sobre();
  s.respuestas.extra = { relleno: Array.from({ length: 80 }, () => 'x'.repeat(15000)) };
  const real = await llamar({ cuerpo: s });
  assert.equal(real.status, 413);
  SIN_DB(real);
});

test('JSON roto y formato ajeno', async () => {
  assert.equal((await llamar({ cuerpo: '{"formato_envio":' })).status, 400);
  assert.equal((await llamar({ cuerpo: { hola: 1 } })).status, 400);
  const r = await llamar({ cuerpo: sobre({ respuestas: { ...copia(RESPUESTAS), formato: 'otra-cosa' } }) });
  assert.equal(r.status, 400);
  SIN_DB(r);
});

test('la casilla trampa rellena se rechaza sin tocar la base de datos', async () => {
  const r = await llamar({ cuerpo: sobre({ control: 'https://spam.example' }) });
  assert.equal(r.status, 400);
  assert.equal(r.json.error, 'control');
  SIN_DB(r);
});

test('campos obligatorios: empresa, nombre y email válido', async () => {
  const s = sobre();
  s.respuestas.empresa.nombre = '';
  s.respuestas.respondente.email = 'no-es-un-email';
  const r = await llamar({ cuerpo: s });
  assert.equal(r.status, 422);
  assert.equal(r.json.error, 'campos');
  assert.match(r.json.mensaje, /nombre de la empresa/);
  assert.match(r.json.mensaje, /email/);
  SIN_DB(r);
});

test('exige el consentimiento', async () => {
  const r = await llamar({ cuerpo: sobre({ consentimiento: false }) });
  assert.equal(r.status, 422);
  assert.equal(r.json.error, 'consentimiento');
  SIN_DB(r);
});

test('privacidad: rechaza un teléfono en el texto libre y no lo repite en la respuesta', async () => {
  const s = sobre();
  s.respuestas.areas.ventas.procesos[0].pasos[0].como = 'Llamo al cliente al 612 345 678 y le explico';
  const r = await llamar({ cuerpo: s });
  assert.equal(r.status, 422);
  assert.equal(r.json.error, 'privacidad');
  assert.match(r.json.mensaje, /un teléfono en Ventas · proceso 1 · paso 1 · cómo se hace/);
  assert.doesNotMatch(r.texto, /612|345|678/);
  SIN_DB(r);
});

test('privacidad: correo, IBAN y contraseña en texto libre', async () => {
  const s = sobre();
  s.respuestas.comentarios = 'Escribid a alguien@empresa.es, cuenta ES9121000418450200051332, contraseña: hola123';
  const r = await llamar({ cuerpo: s });
  assert.equal(r.status, 422);
  for (const t of ['correo electrónico', 'cuenta bancaria', 'contraseña']) assert.match(r.json.mensaje, new RegExp(t));
  assert.doesNotMatch(r.texto, /alguien@|ES9121|hola123/);
});

test('privacidad: el email de contacto y la web de la empresa no cuentan (igual que en el kit)', async () => {
  const r = await llamar({ cuerpo: sobre() });
  assert.equal(r.status, 201);
});

test('envío correcto: guarda, avisa a n8n autenticado y marca el aviso', async () => {
  const r = await llamar({ cuerpo: sobre() });
  assert.equal(r.status, 201);
  assert.deepEqual(r.json, { ok: true, referencia: '3F2A9C1E' });

  const insert = r.servicios.de('/rest/v1/diagnosticos')[0];
  assert.equal(insert.cuerpo.empresa, 'Empresa ficticia de prueba');
  assert.equal(insert.cuerpo.consentimiento_aceptado, true);
  assert.equal(insert.cuerpo.consentimiento_version, 'prueba-1');
  assert.deepEqual(insert.cuerpo.respuestas, RESPUESTAS);
  assert.equal(insert.cabeceras.apikey, CLAVE_SUPABASE);
  assert.equal(insert.cabeceras.Authorization, undefined, 'las claves sb_secret_ van solo en apikey');

  const avisos = r.servicios.de(N8N_URL);
  assert.equal(avisos.length, 1);
  assert.equal(avisos[0].cabeceras.Authorization, `Bearer ${SECRETO_N8N}`);
  assert.deepEqual(Object.keys(avisos[0].cuerpo).sort(), ['empresa', 'evento', 'id', 'recibido_en', 'respuestas']);
  assert.doesNotMatch(JSON.stringify(avisos[0].cuerpo), new RegExp(`${CLAVE_SUPABASE}|203\\.0\\.113\\.7`));

  const orden = r.servicios.llamadas.map((l) => new URL(l.url).pathname);
  assert.deepEqual(orden, ['/rest/v1/rpc/registrar_intento_envio', '/rest/v1/rpc/registrar_intento_envio', '/rest/v1/diagnosticos', '/webhook/diagnostico', '/rest/v1/rpc/marcar_notificacion']);
  assert.deepEqual(r.servicios.de('marcar_notificacion')[0].cuerpo, { p_id: '3f2a9c1e-0000-4000-8000-000000000001', p_estado: 'enviada', p_error: null });
});

test('las claves antiguas (JWT service_role) van también en Authorization', async () => {
  const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.firma-de-prueba';
  const r = await llamar({ cuerpo: sobre(), env: entorno({ SUPABASE_SECRET_KEY: jwt }) });
  assert.equal(r.status, 201);
  assert.equal(r.servicios.de('/rest/v1/diagnosticos')[0].cabeceras.Authorization, `Bearer ${jwt}`);
  assert.equal(r.servicios.de(N8N_URL)[0].cabeceras.Authorization, `Bearer ${SECRETO_N8N}`);
});

test('si n8n responde con error, el diagnóstico queda guardado y marcado como fallido', async () => {
  const r = await llamar({ cuerpo: sobre(), servicios: serviciosFalsos({ n8nStatus: 500 }) });
  assert.equal(r.status, 201);
  assert.equal(r.json.ok, true);
  assert.deepEqual(r.servicios.de('marcar_notificacion')[0].cuerpo.p_estado, 'fallida');
  assert.equal(r.servicios.de('marcar_notificacion')[0].cuerpo.p_error, 'n8n_http_500');
  assert.ok(r.registros.some((x) => x.evento === 'notificacion_fallida'));
});

test('si n8n no contesta a tiempo, se corta y queda marcado como fallido', async () => {
  const r = await llamar({ cuerpo: sobre(), servicios: serviciosFalsos({ n8nCuelga: true }), tiempoN8nMs: 30 });
  assert.equal(r.status, 201);
  assert.equal(r.servicios.de('marcar_notificacion')[0].cuerpo.p_error, 'n8n_timeout');
});

test('si falla marcar el aviso, el cliente recibe igualmente «Recibido» (queda pendiente)', async () => {
  const r = await llamar({ cuerpo: sobre(), servicios: serviciosFalsos({ marcarStatus: 500 }) });
  assert.equal(r.status, 201);
  assert.ok(r.registros.some((x) => x.evento === 'marcar_notificacion_error'));
});

test('si falla el guardado: error real, sin avisar a n8n y sin detalles internos', async () => {
  const r = await llamar({ cuerpo: sobre(), servicios: serviciosFalsos({ insertStatus: 500 }) });
  assert.equal(r.status, 503);
  assert.equal(r.json.ok, false);
  assert.equal(r.json.error, 'almacenamiento');
  assert.match(r.json.mensaje, /descárgalas/);
  assert.doesNotMatch(r.texto, /Empresa ficticia|supabase|500/i);
  assert.equal(r.servicios.de(N8N_URL).length, 0);
});

test('si falla el límite de frecuencia (Supabase caído) no se guarda nada', async () => {
  const r = await llamar({ cuerpo: sobre(), servicios: serviciosFalsos({ rpcStatus: 500 }) });
  assert.equal(r.status, 503);
  assert.equal(r.servicios.de('/rest/v1/diagnosticos').length, 0);
});

test('límite por IP: 429 con Retry-After y sin guardar', async () => {
  const r = await llamar({ cuerpo: sobre(), servicios: serviciosFalsos({ limiteIp: false }) });
  assert.equal(r.status, 429);
  assert.equal(r.json.error, 'limite_ip');
  assert.equal(r.cabeceras['retry-after'], '3600');
  assert.equal(r.servicios.de('/rest/v1/diagnosticos').length, 0);
});

test('límite global diario', async () => {
  const r = await llamar({ cuerpo: sobre(), servicios: serviciosFalsos({ limiteGlobal: false }) });
  assert.equal(r.status, 429);
  assert.equal(r.json.error, 'limite_global');
});

test('IP: fuera de Vercel se ignora x-forwarded-for (no se confía en cabeceras del cliente)', async () => {
  const env = entorno();
  const r = await llamar({ cuerpo: sobre(), cabeceras: { 'x-forwarded-for': '1.2.3.4', 'x-real-ip': '1.2.3.4' }, ip: '198.51.100.20', env });
  const clave = r.servicios.de('registrar_intento_envio')[0].cuerpo.p_clave;
  assert.equal(clave, `ip:${hashIp('198.51.100.20', env.IP_HASH_SECRET)}`);
});

test('IP: en Vercel se usa x-vercel-forwarded-for, no el primer valor de x-forwarded-for', async () => {
  const env = entorno({ VERCEL: '1' });
  const r = await llamar({ cuerpo: sobre(), env, cabeceras: { 'x-forwarded-for': '6.6.6.6, 198.51.100.30', 'x-vercel-forwarded-for': '198.51.100.30' } });
  const clave = r.servicios.de('registrar_intento_envio')[0].cuerpo.p_clave;
  assert.equal(clave, `ip:${hashIp('198.51.100.30', env.IP_HASH_SECRET)}`);
});

test('en Vercel no se acepta http:// como origen', async () => {
  const r = await llamar({ cuerpo: sobre(), env: entorno({ VERCEL: '1' }), cabeceras: { origin: 'http://cuestionario.example.com' } });
  assert.equal(r.status, 403);
});

test('la IP se guarda solo como HMAC y nunca aparece en los registros', async () => {
  const r = await llamar({ cuerpo: sobre(), ip: '192.0.2.55' });
  assert.doesNotMatch(JSON.stringify(r.servicios.llamadas), /192\.0\.2\.55/);
  assert.doesNotMatch(JSON.stringify(r.registros), /192\.0\.2\.55|prueba@example|Empresa ficticia|Persona de prueba/);
});

test('las respuestas de error nunca devuelven cabeceras CORS', async () => {
  for (const r of [await llamar({ metodo: 'OPTIONS' }), await llamar({ cuerpo: sobre() })]) {
    assert.equal(r.cabeceras['access-control-allow-origin'], undefined);
    assert.equal(r.cabeceras['cache-control'], 'no-store');
  }
});
