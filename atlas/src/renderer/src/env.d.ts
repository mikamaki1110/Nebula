/// <reference types="vite/client" />
import type { AtlasApi } from '@shared/contract'

declare global {
  interface Window {
    atlas: AtlasApi
  }
}
