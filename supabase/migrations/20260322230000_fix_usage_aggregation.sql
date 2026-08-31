-- Fix usage aggregation: add record_hash dedup + server-side RPC aggregation
-- Only user's data exists; truncate and re-backfill with correct hashes.

truncate public.usage_records;

-- Add record_hash column for content-based deduplication
alter table public.usage_records
  add column record_hash text not null;

-- Replace timestamp-based dedup with hash-based dedup
drop index if exists public.idx_usage_dedup;
create unique index idx_usage_record_hash
  on public.usage_records (user_id, device_id, record_hash);

-- ── RPC: daily usage summary (server-side aggregation, no row limit) ──

create or replace function public.get_cloud_usage_summary(
  p_utc_start timestamptz,
  p_utc_end timestamptz,
  p_tz_offset_minutes integer default 0,
  p_bucket_hours integer default 2
)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with filtered as (
    select
      device_id,
      model,
      coalesce(project, 'unknown') as project_path,
      input_tokens,
      output_tokens,
      cost_usd,
      (recorded_at at time zone 'UTC' + make_interval(mins => p_tz_offset_minutes)) as local_ts
    from public.usage_records
    where user_id = auth.uid()
      and recorded_at >= p_utc_start
      and recorded_at < p_utc_end
  ),
  summary as (
    select
      count(*)::integer as sessions,
      coalesce(sum(input_tokens), 0)::bigint as total_input,
      coalesce(sum(output_tokens), 0)::bigint as total_output,
      coalesce(sum(cost_usd), 0)::numeric as total_cost
    from filtered
  ),
  buckets as (
    select
      (floor(extract(hour from local_ts) / greatest(p_bucket_hours, 1))::integer
        * greatest(p_bucket_hours, 1)) as hour_start,
      coalesce(sum(input_tokens), 0)::bigint as input,
      coalesce(sum(output_tokens), 0)::bigint as output,
      coalesce(sum(cost_usd), 0)::numeric as cost,
      count(*)::integer as calls
    from filtered
    group by hour_start
  ),
  projects as (
    select project_path,
      coalesce(sum(input_tokens), 0)::bigint as input,
      coalesce(sum(output_tokens), 0)::bigint as output,
      coalesce(sum(cost_usd), 0)::numeric as cost,
      count(*)::integer as calls
    from filtered group by project_path
  ),
  models as (
    select model,
      coalesce(sum(input_tokens), 0)::bigint as input,
      coalesce(sum(output_tokens), 0)::bigint as output,
      coalesce(sum(cost_usd), 0)::numeric as cost,
      count(*)::integer as calls
    from filtered group by model
  ),
  devices as (
    select device_id,
      coalesce(sum(input_tokens), 0)::bigint as input,
      coalesce(sum(output_tokens), 0)::bigint as output,
      coalesce(sum(cost_usd), 0)::numeric as cost,
      count(*)::integer as calls
    from filtered group by device_id
  )
  select jsonb_build_object(
    'sessions', summary.sessions,
    'totalInput', summary.total_input,
    'totalOutput', summary.total_output,
    'totalCost', summary.total_cost,
    'buckets', coalesce((
      select jsonb_agg(jsonb_build_object(
        'hourStart', hour_start, 'input', input, 'output', output, 'cost', cost, 'calls', calls
      ) order by hour_start) from buckets
    ), '[]'::jsonb),
    'projects', coalesce((
      select jsonb_agg(jsonb_build_object(
        'path', project_path, 'input', input, 'output', output, 'cost', cost, 'calls', calls
      ) order by cost desc) from projects
    ), '[]'::jsonb),
    'models', coalesce((
      select jsonb_agg(jsonb_build_object(
        'model', model, 'input', input, 'output', output, 'cost', cost, 'calls', calls
      ) order by cost desc) from models
    ), '[]'::jsonb),
    'devices', coalesce((
      select jsonb_agg(jsonb_build_object(
        'deviceId', device_id, 'input', input, 'output', output, 'cost', cost, 'calls', calls
      ) order by cost desc) from devices
    ), '[]'::jsonb)
  )
  from summary;
$$;

-- ── RPC: heatmap (server-side aggregation, no row limit) ──

create or replace function public.get_cloud_usage_heatmap(
  p_utc_start timestamptz,
  p_tz_offset_minutes integer default 0
)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with filtered as (
    select
      to_char(
        (recorded_at at time zone 'UTC' + make_interval(mins => p_tz_offset_minutes))::date,
        'YYYY-MM-DD'
      ) as local_date,
      (input_tokens + output_tokens)::bigint as tokens,
      cost_usd
    from public.usage_records
    where user_id = auth.uid()
      and recorded_at >= p_utc_start
  ),
  daily as (
    select local_date,
      coalesce(sum(tokens), 0)::bigint as tokens,
      coalesce(sum(cost_usd), 0)::numeric as cost
    from filtered group by local_date
  )
  select coalesce(
    jsonb_object_agg(local_date, jsonb_build_object('tokens', tokens, 'cost', cost)),
    '{}'::jsonb
  ) from daily;
$$;

grant execute on function public.get_cloud_usage_summary(timestamptz, timestamptz, integer, integer) to authenticated;
grant execute on function public.get_cloud_usage_heatmap(timestamptz, integer) to authenticated;
