-- Esquema de Supabase para el cuestionario de diagnóstico de CLEAN.
--
-- Se ejecuta UNA vez en el editor SQL del proyecto (ver README.md).
-- No borra nada: solo crea lo que no existe (create ... if not exists / or replace).
-- Acceso: RLS activado y SIN políticas → nadie puede leer ni escribir con la clave
-- pública. Solo el servidor (función de Vercel, con la clave secreta) y el panel
-- de Supabase acceden a los datos.

-- 1. Diagnósticos recibidos ---------------------------------------------------
create table if not exists public.diagnosticos (
  id                          uuid primary key default gen_random_uuid(),
  recibido_en                 timestamptz not null default now(),
  empresa                     text not null check (char_length(empresa) between 1 and 200),
  version_formulario          text,
  respuestas                  jsonb not null,
  consentimiento_aceptado     boolean not null check (consentimiento_aceptado),
  consentimiento_version      text not null,
  consentimiento_en           timestamptz not null default now(),
  -- Estado de trabajo del diagnóstico (lo cambias tú a mano o desde n8n).
  estado                      text not null default 'recibido'
                              check (estado in ('recibido', 'en_revision', 'diagnosticado', 'archivado')),
  -- Aviso a n8n: pendiente → enviada | fallida.
  notificacion_estado         text not null default 'pendiente'
                              check (notificacion_estado in ('pendiente', 'enviada', 'fallida')),
  notificacion_intentos       integer not null default 0,
  notificacion_ultimo_intento timestamptz,
  notificacion_error          text   -- solo un código técnico (p. ej. n8n_timeout), nunca datos
);

create index if not exists diagnosticos_notificacion_idx on public.diagnosticos (notificacion_estado, recibido_en);
create index if not exists diagnosticos_recibido_idx on public.diagnosticos (recibido_en desc);

alter table public.diagnosticos enable row level security;
revoke all on table public.diagnosticos from anon, authenticated;

-- 2. Límite de frecuencia de envíos --------------------------------------------
-- Guarda solo un HMAC de la IP (nunca la IP) o la clave 'global'. Las filas de más
-- de 2 días se borran solas en cada envío.
create table if not exists public.envios_limite (
  clave  text not null,
  creado timestamptz not null default now()
);

create index if not exists envios_limite_idx on public.envios_limite (clave, creado);

alter table public.envios_limite enable row level security;
revoke all on table public.envios_limite from anon, authenticated;

-- Registra un intento si cabe en el límite. Devuelve true (cabe) o false (no cabe).
-- El bloqueo por clave hace que dos envíos simultáneos no se cuelen a la vez.
create or replace function public.registrar_intento_envio(p_clave text, p_max integer, p_ventana_segundos integer)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  n integer;
begin
  perform pg_advisory_xact_lock(hashtext(p_clave));
  delete from public.envios_limite where creado < now() - interval '2 days';
  select count(*) into n
    from public.envios_limite
   where clave = p_clave
     and creado > now() - make_interval(secs => p_ventana_segundos);
  if n >= p_max then
    return false;
  end if;
  insert into public.envios_limite (clave) values (p_clave);
  return true;
end;
$$;

revoke all on function public.registrar_intento_envio(text, integer, integer) from public, anon, authenticated;
grant execute on function public.registrar_intento_envio(text, integer, integer) to service_role;

-- 3. Estado del aviso a n8n ------------------------------------------------------
create or replace function public.marcar_notificacion(p_id uuid, p_estado text, p_error text)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_estado not in ('enviada', 'fallida') then
    raise exception 'estado no válido';
  end if;
  update public.diagnosticos
     set notificacion_estado = p_estado,
         notificacion_intentos = notificacion_intentos + 1,
         notificacion_ultimo_intento = now(),
         notificacion_error = case when p_estado = 'fallida' then left(p_error, 60) else null end
   where id = p_id;
end;
$$;

revoke all on function public.marcar_notificacion(uuid, text, text) from public, anon, authenticated;
grant execute on function public.marcar_notificacion(uuid, text, text) to service_role;

-- 4. Vista para revisar avisos pendientes o fallidos (sin las respuestas) --------
create or replace view public.diagnosticos_por_notificar
with (security_invoker = true) as
select id, recibido_en, empresa, notificacion_estado, notificacion_intentos, notificacion_ultimo_intento, notificacion_error
  from public.diagnosticos
 where notificacion_estado <> 'enviada';

revoke all on public.diagnosticos_por_notificar from anon, authenticated;
