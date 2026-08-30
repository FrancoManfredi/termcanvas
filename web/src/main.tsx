import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/geist-sans/400.css'
import '@fontsource/geist-sans/500.css'
import '@fontsource/geist-mono/400.css'
import './index.css'
import App from './App.tsx'
import { WorkItemStoreProvider } from './lib/factory/store/WorkItemStoreContext.tsx'
import { FactoryWorkspaceProvider } from './lib/factory/store/FactoryWorkspaceProvider.tsx'
import { FactoryWorkspaceStore } from './lib/factory/store/factoryWorkspace.store.ts'
import { createLocalStoragePort } from './lib/factory/store/storage.port.ts'

// DIP: la raíz de composición elige el adaptador de persistencia (R13).
const workspaceStore = new FactoryWorkspaceStore(createLocalStoragePort())

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <WorkItemStoreProvider>
      <FactoryWorkspaceProvider store={workspaceStore}>
        <App />
      </FactoryWorkspaceProvider>
    </WorkItemStoreProvider>
  </StrictMode>,
)
