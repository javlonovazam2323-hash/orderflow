/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string
  readonly VITE_SUPABASE_ANON_KEY: string
  readonly VITE_USE_MOCK: string
  readonly VITE_PWA_DEV: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
