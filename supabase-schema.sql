-- ============================================================
-- ABSENSI APP - Supabase SQL Schema
-- Jalankan di Supabase SQL Editor
-- ============================================================

-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- ============================================================
-- TABEL: users (extend auth.users Supabase)
-- ============================================================
create table public.users (
  id uuid references auth.users(id) on delete cascade primary key,
  name text not null,
  email text not null unique,
  role text not null default 'employee' check (role in ('admin', 'employee')),
  phone text,
  avatar_url text,
  is_active boolean default true,
  created_at timestamptz default now()
);

-- ============================================================
-- TABEL: locations
-- ============================================================
create table public.locations (
  id uuid default uuid_generate_v4() primary key,
  name text not null,
  address text,
  latitude double precision not null,
  longitude double precision not null,
  radius_meter int not null default 100,
  is_active boolean default true,
  created_at timestamptz default now()
);

-- ============================================================
-- TABEL: attendances
-- ============================================================
create table public.attendances (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references public.users(id) on delete cascade not null,
  location_id uuid references public.locations(id) not null,
  check_in_time timestamptz not null,
  check_out_time timestamptz,
  check_in_lat double precision not null,
  check_in_lng double precision not null,
  check_out_lat double precision,
  check_out_lng double precision,
  selfie_in_url text,
  selfie_out_url text,
  status text default 'present' check (status in ('present', 'late', 'incomplete')),
  total_hours double precision,
  notes text,
  created_at timestamptz default now()
);

-- ============================================================
-- TABEL: salary_rates
-- ============================================================
create table public.salary_rates (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references public.users(id) on delete cascade not null,
  hourly_rate numeric(12,2) not null,
  currency text default 'IDR',
  effective_from date not null default current_date,
  created_at timestamptz default now()
);

-- ============================================================
-- TABEL: payroll_summary
-- ============================================================
create table public.payroll_summary (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references public.users(id) on delete cascade not null,
  month int not null check (month between 1 and 12),
  year int not null,
  total_days int default 0,
  total_hours double precision default 0,
  total_salary numeric(14,2) default 0,
  hourly_rate numeric(12,2) default 0,
  status text default 'draft' check (status in ('draft', 'finalized')),
  generated_at timestamptz default now(),
  unique(user_id, month, year)
);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
alter table public.users enable row level security;
alter table public.locations enable row level security;
alter table public.attendances enable row level security;
alter table public.salary_rates enable row level security;
alter table public.payroll_summary enable row level security;

-- Helper function: get current user role
create or replace function public.get_user_role()
returns text as $$
  select role from public.users where id = auth.uid();
$$ language sql security definer;

-- USERS policies
create policy "User can see own profile" on public.users
  for select using (auth.uid() = id);
create policy "Admin can see all users" on public.users
  for select using (public.get_user_role() = 'admin');
create policy "Admin can insert users" on public.users
  for insert with check (public.get_user_role() = 'admin');
create policy "Admin can update users" on public.users
  for update using (public.get_user_role() = 'admin');

-- LOCATIONS policies
create policy "All can see active locations" on public.locations
  for select using (is_active = true);
create policy "Admin can manage locations" on public.locations
  for all using (public.get_user_role() = 'admin');

-- ATTENDANCES policies
create policy "Employee sees own attendance" on public.attendances
  for select using (auth.uid() = user_id);
create policy "Admin sees all attendance" on public.attendances
  for select using (public.get_user_role() = 'admin');
create policy "Employee can insert own attendance" on public.attendances
  for insert with check (auth.uid() = user_id);
create policy "Employee can update own attendance" on public.attendances
  for update using (auth.uid() = user_id);
create policy "Admin can update any attendance" on public.attendances
  for update using (public.get_user_role() = 'admin');

-- SALARY RATES policies
create policy "Admin can manage salary rates" on public.salary_rates
  for all using (public.get_user_role() = 'admin');
create policy "Employee sees own rate" on public.salary_rates
  for select using (auth.uid() = user_id);

-- PAYROLL policies
create policy "Admin can manage payroll" on public.payroll_summary
  for all using (public.get_user_role() = 'admin');
create policy "Employee sees own payroll" on public.payroll_summary
  for select using (auth.uid() = user_id);

-- ============================================================
-- STORAGE: selfie bucket
-- ============================================================
insert into storage.buckets (id, name, public) values ('selfies', 'selfies', false);

create policy "Employee can upload selfie" on storage.objects
  for insert with check (bucket_id = 'selfies' AND auth.role() = 'authenticated');
create policy "Authenticated can view selfies" on storage.objects
  for select using (bucket_id = 'selfies' AND auth.role() = 'authenticated');

-- ============================================================
-- FUNGSI: auto-set total_hours saat check_out
-- ============================================================
create or replace function public.calculate_total_hours()
returns trigger as $$
begin
  if NEW.check_out_time is not null and NEW.check_in_time is not null then
    NEW.total_hours = extract(epoch from (NEW.check_out_time - NEW.check_in_time)) / 3600.0;
  end if;
  return NEW;
end;
$$ language plpgsql;

create trigger trg_calculate_hours
  before insert or update on public.attendances
  for each row execute function public.calculate_total_hours();
