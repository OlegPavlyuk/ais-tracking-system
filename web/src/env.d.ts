/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_MAP_STYLE_URL?: string;
  readonly VITE_SUPPORTED_BBOX?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
