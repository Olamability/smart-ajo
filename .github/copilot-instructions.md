# Copilot Instructions for Secured-Ajo

## Project Overview

- **Frontend**: Vite + React + TypeScript (port 3000, see `src/`)
- **Backend**: Supabase (Auth, DB, Storage, Edge Functions; see `supabase/`)
- **No Node.js/Express backend**: All business logic is in Supabase (SQL, RLS, Edge Functions)

## Key Architectural Patterns

- **Strict client-server separation**: Frontend only uses `VITE_*` env vars and Supabase anon key
- **All sensitive logic and data access**: Enforced by Supabase Row Level Security (RLS) and SQL functions
- **Active Supabase client**: Use `src/lib/client/supabase.ts` for frontend DB access

## Developer Workflows

- **Start dev server**: `npm run dev` (starts Vite on port 3000)
- **Build**: `npm run build`
- **Preview production**: `npm run preview`
- **Lint**: `npm run lint`
- **Install UI components**: `npx shadcn@latest add [component-name]`

## Environment & Security

- **Frontend env vars**: Only `VITE_*` keys (see `.env.example`)
- **Backend secrets**: Never exposed to frontend
- **RLS**: All tables locked down by default; policies in `supabase/schema.sql`
- **Auth**: Supabase Auth only; no custom backend auth

## Project Structure

- `src/` — React app, components, hooks, services, types
- `supabase/` — DB schema, storage, triggers, functions, docs
- `public/` — Static assets

## Integration Points

- **Supabase**: All data, auth, and storage via Supabase client
- **Paystack**: Payment integration via public key in frontend, secret key in Supabase Edge Functions (never in frontend)

## Examples

- **Supabase client import**:
  ```ts
  import { createClient } from "@/lib/client/supabase";
  ```
- **API calls**: Use Supabase client directly from React components/services

## Documentation

- [README.md](../README.md): Quick start, env setup, scripts
- [ARCHITECTURE.md](../ARCHITECTURE.md): Complete architecture guide
- [supabase/README.md](../supabase/README.md): DB setup, schema, advanced features
