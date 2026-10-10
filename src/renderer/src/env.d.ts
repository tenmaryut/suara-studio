/// <reference types="vite/client" />
import type { SuaraApi } from '../../shared/ipc'

declare global {
  interface Window {
    suara: SuaraApi
  }
}

export {}
