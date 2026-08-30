import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/geist-sans/400.css'
import '@fontsource/geist-sans/500.css'
import '@fontsource/geist-mono/400.css'
import './index.css'
import App from './App.tsx'
import { WorkItemStoreProvider } from './lib/factory/store/WorkItemStoreContext.tsx'
import { FactoryWorkspaceProvider } from './lib/factory/store/FactoryWorkspaceProvider.tsx'
import { createFactoryAdapters } from './lib/factory/adapters/adapterFactory.ts'
import { isBackendEnabled } from './lib/factory/config/featureFlags.ts'
import type { FactoryWorkspaceStore } from './lib/factory/store/factoryWorkspace.store.ts'
import type { WorkItemStore } from './lib/factory/store/workItem.store.ts'

// DIP: composición raíz — único if fail-closed local (ADR-002 9.4)
// Si VITE_FACTORY_BACKEND !== "remote" → LocalAdapter (memory/localStorage); si "remote" → RemoteAdapter (FetchTransport + SQLite)
const adapters = isBackendEnabled() ? createFactoryAdapters("remote") : createFactoryAdapters("local")

// Los providers existentes esperan FactoryWorkspaceStore / WorkItemStore concretos; los adapters satisfacen los ports y se castean
// Este es el ÚNICO lugar donde se lee VITE_FACTORY_BACKEND (prohibido en domain/páginas)
const workspaceStore = adapters.factoryRepo as unknown as FactoryWorkspaceStore
const workItemStore = adapters.workItemRepo as unknown as WorkItemStore

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <WorkItemStoreProvider store={workItemStore}>
      <FactoryWorkspaceProvider store={workspaceStore}>
        <App />
      </FactoryWorkspaceProvider>
    </WorkItemStoreProvider>
  </StrictMode>,
)
