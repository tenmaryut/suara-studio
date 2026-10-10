import './styles.css'
import { createTranslator } from '../../shared/i18n'
import { App } from './app'

async function bootstrap(): Promise<void> {
  const root = document.getElementById('app')
  if (!root) throw new Error('Missing #app element')
  const info = await window.suara.getAppInfo()
  document.documentElement.lang = info.locale
  document.documentElement.dataset.platform = info.platform
  new App(root, window.suara, info, createTranslator(info.locale))
}

void bootstrap()
