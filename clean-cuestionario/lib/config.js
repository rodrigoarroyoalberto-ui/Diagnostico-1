/* Configuración del servidor, solo desde variables de entorno (nunca en el código).
 * Ver .env.example y README.md. */

const entero = (v, porDefecto, min, max) => {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n >= min && n <= max ? n : porDefecto;
};

/* http:// solo se admite para 127.0.0.1/localhost (pruebas locales). */
const urlSegura = (v) => {
  try {
    const u = new URL(v);
    return u.protocol === 'https:' || (u.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(u.hostname));
  } catch { return false; }
};

export function leerConfig(env = process.env) {
  const c = {
    enviosHabilitados: env.ENVIOS_HABILITADOS === 'true',
    supabaseUrl: (env.SUPABASE_URL || '').replace(/\/+$/, ''),
    supabaseClave: env.SUPABASE_SECRET_KEY || '',
    n8nUrl: env.N8N_WEBHOOK_URL || '',
    n8nSecreto: env.N8N_WEBHOOK_SECRET || '',
    ipSecreto: env.IP_HASH_SECRET || '',
    versionAviso: env.AVISO_PRIVACIDAD_VERSION || '',
    origenesExtra: (env.ORIGENES_PERMITIDOS || '').split(',').map((s) => s.trim().replace(/\/+$/, '')).filter(Boolean),
    limitePorIpHora: entero(env.LIMITE_POR_IP_HORA, 5, 1, 1000),
    limiteGlobalDia: entero(env.LIMITE_GLOBAL_DIA, 200, 1, 100000),
    enVercel: env.VERCEL === '1',
  };
  const problemas = [];
  if (!urlSegura(c.supabaseUrl)) problemas.push('SUPABASE_URL');
  if (!c.supabaseClave) problemas.push('SUPABASE_SECRET_KEY');
  if (!urlSegura(c.n8nUrl)) problemas.push('N8N_WEBHOOK_URL');
  if (c.n8nSecreto.length < 32) problemas.push('N8N_WEBHOOK_SECRET (mínimo 32 caracteres)');
  if (c.ipSecreto.length < 32) problemas.push('IP_HASH_SECRET (mínimo 32 caracteres)');
  if (!c.versionAviso) problemas.push('AVISO_PRIVACIDAD_VERSION');
  c.problemas = problemas;
  return c;
}
