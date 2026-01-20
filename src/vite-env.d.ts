/// <reference types="vite/client" />

interface ImportMetaEnv {
  // Vite built-in properties
  readonly DEV: boolean;
  readonly PROD: boolean;
  readonly MODE: string;
  readonly SSR: boolean;
  
  // App-specific environment variables
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  readonly VITE_APP_NAME: string;
  readonly VITE_APP_URL: string;
  readonly VITE_PAYSTACK_PUBLIC_KEY?: string;
  readonly VITE_ENABLE_KYC?: string;
  readonly VITE_ENABLE_BVN_VERIFICATION?: string;
  readonly VITE_ENABLE_EMAIL_VERIFICATION?: string;
  readonly VITE_ENABLE_PHONE_VERIFICATION?: string;
  readonly VITE_BYPASS_AUTH?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
