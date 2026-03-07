# Tech Stack — Smart Ajo

Smart Ajo is a full-stack web application for managing rotating savings groups (Ajo/Esusu). Below is a complete breakdown of every technology used across the frontend, backend, and tooling layers.

---

## 🖥️ Frontend

| Layer | Technology | Version |
|---|---|---|
| UI Framework | [React](https://react.dev/) | 18.3.1 |
| Language | [TypeScript](https://www.typescriptlang.org/) | 5.8.3 |
| Build Tool | [Vite](https://vitejs.dev/) | 5.4.11 |
| Client-side Routing | [React Router DOM](https://reactrouter.com/) | 6.28.0 |

---

## 🎨 Styling & UI Components

| Layer | Technology | Version |
|---|---|---|
| CSS Framework | [Tailwind CSS](https://tailwindcss.com/) | 3.4.19 |
| Headless Components | [Radix UI](https://www.radix-ui.com/) (20+ primitives) | latest |
| Component Library | [Shadcn UI](https://ui.shadcn.com/) | — |
| Class Utilities | [tailwind-merge](https://github.com/dcastil/tailwind-merge) | 2.6.0 |
| Variant Helpers | [class-variance-authority](https://cva.style/) | 0.7.1 |
| Icons | [Lucide React](https://lucide.dev/) | latest |
| Toast Notifications | [Sonner](https://sonner.emilkowal.ski/) | latest |
| Carousel | [Embla Carousel](https://www.embla-carousel.com/) | latest |
| Drawer | [Vaul](https://vaul.emilkowal.ski/) | latest |
| Command Palette | [cmdk](https://cmdk.paco.me/) | latest |
| OTP Input | [input-otp](https://github.com/guilhermerodz/input-otp) | latest |
| Resizable Panels | [react-resizable-panels](https://github.com/bvaughn/react-resizable-panels) | latest |

---

## 📊 Data, Forms & State

| Layer | Technology | Version |
|---|---|---|
| Server State / Data Fetching | [TanStack React Query](https://tanstack.com/query) | 5.83.0 |
| Form Management | [React Hook Form](https://react-hook-form.com/) | 7.61.1 |
| Schema Validation | [Zod](https://zod.dev/) | 3.25.76 |
| Hookform Resolvers | [@hookform/resolvers](https://github.com/react-hook-form/resolvers) | 3.10.0 |
| Charts / Analytics UI | [Recharts](https://recharts.org/) | 2.15.4 |
| Date Utilities | [date-fns](https://date-fns.org/) | 3.6.0 |
| Date Picker | [react-day-picker](https://react-day-picker.js.org/) | 8.10.1 |

---

## 🗄️ Backend

| Layer | Technology | Notes |
|---|---|---|
| Database | [PostgreSQL](https://www.postgresql.org/) via Supabase | Hosted by Supabase |
| Auth | [Supabase Auth](https://supabase.com/docs/guides/auth) | Email/password, magic link |
| File Storage | [Supabase Storage](https://supabase.com/docs/guides/storage) | Avatars bucket |
| Serverless Functions | [Supabase Edge Functions](https://supabase.com/docs/guides/functions) (Deno) | Payment verification, webhooks, BVN check |
| Row-Level Security | PostgreSQL RLS policies | All tables locked down by default |
| Supabase JS Client | [@supabase/supabase-js](https://github.com/supabase/supabase-js) | 2.89.0 |
| Supabase SSR | [@supabase/ssr](https://github.com/supabase/ssr) | 0.8.0 |

### Edge Functions

| Function | Purpose |
|---|---|
| `verify-payment` | Securely verifies Paystack payments and activates membership |
| `paystack-webhook` | Handles Paystack webhook events |
| `verify-bvn` | BVN (Bank Verification Number) identity verification |

### Database Schema Highlights

- **14+ tables**: users, wallets, groups, group_members, contributions, transactions, payouts, penalties, notifications, audit_logs, …
- **12+ custom ENUMs** for type safety (e.g., `kyc_status`, `group_status`, `transaction_type`)
- **RLS policies** enforced on every table
- **PostgreSQL triggers** for automated wallet creation, member count updates, and timestamps
- **RPC functions** for group management, analytics, and profile operations

---

## 💳 Payments

| Service | Role |
|---|---|
| [Paystack](https://paystack.com/) | Payment gateway (contributions & wallet top-ups) |

- Public key is exposed to the frontend via `VITE_PAYSTACK_PUBLIC_KEY`.
- Secret key is **only** used inside Supabase Edge Functions and never in the browser.

---

## 📄 Document Generation

| Library | Purpose | Version |
|---|---|---|
| [jsPDF](https://parall.ax/products/jspdf) | PDF generation | 4.0.0 |
| [jspdf-autotable](https://github.com/simonbengtsson/jsPDF-AutoTable) | Table export to PDF | 5.0.7 |

---

## 🛠️ Developer Tooling

| Tool | Purpose | Version |
|---|---|---|
| [Vite](https://vitejs.dev/) | Dev server & bundler | 5.4.11 |
| [TypeScript](https://www.typescriptlang.org/) | Static typing | 5.8.3 |
| [ESLint](https://eslint.org/) | Linting (TS + React hooks) | 9.x |
| [PostCSS](https://postcss.org/) | CSS processing | 8.5.6 |
| [Autoprefixer](https://github.com/postcss/autoprefixer) | CSS vendor prefixes | 10.4.23 |

---

## ☁️ Deployment

| Platform | Purpose |
|---|---|
| [Vercel](https://vercel.com/) | Frontend hosting (primary, `vercel.json` configured) |
| [Netlify](https://www.netlify.com/) | Alternative frontend hosting |
| [Supabase](https://supabase.com/) | Database, auth, storage, and edge functions |

---

## 🗂️ Project Structure Summary

```
smart-ajo/
├── src/                  # React frontend (components, pages, hooks, services)
│   ├── api/              # Supabase API calls
│   ├── components/       # Reusable UI components (including Shadcn UI)
│   ├── contexts/         # React Context providers (Auth, etc.)
│   ├── hooks/            # Custom React hooks
│   ├── lib/              # Utilities (Supabase client, Paystack, PDF export)
│   ├── pages/            # Route-level page components (16 pages)
│   └── types/            # Shared TypeScript type definitions
├── supabase/
│   ├── functions/        # Deno-based Edge Functions
│   ├── migrations/       # Incremental SQL migrations
│   └── schema.sql        # Complete PostgreSQL schema
└── public/               # Static assets
```

---

## 📌 Environment Variables

All frontend configuration is passed via `VITE_*` environment variables (never secrets):

| Variable | Purpose |
|---|---|
| `VITE_SUPABASE_URL` | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Supabase anonymous (public) key |
| `VITE_PAYSTACK_PUBLIC_KEY` | Paystack public key |
| `VITE_APP_NAME` | Application display name |
| `VITE_APP_URL` | Application base URL |

Backend secrets (Paystack secret key, service role key) are configured directly in Supabase and never exposed to the browser.

---

> For setup instructions see [README.md](./README.md). For database details see [supabase/README.md](./supabase/README.md).
