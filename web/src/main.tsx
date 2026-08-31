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
import { setDefaultGitHubAuthPort } from './lib/factory/hooks/useGitHubAuth.ts'
import type { FactoryWorkspaceStore } from './lib/factory/store/factoryWorkspace.store.ts'
import type { WorkItemStore } from './lib/factory/store/workItem.store.ts'

// DIP: composición raíz — único if fail-closed local (ADR-002 9.4) + quickstart_fullscreen flag (ADR-003 Q4 solo en App.tsx)
// isQuickstartFullscreenEnabled() se lee únicamente en App.tsx gate (no aquí) para evitar flash y mantener flag solo en composición raíz
const adapters = isBackendEnabled() ? createFactoryAdapters("remote") : createFactoryAdapters("local")

// FIX: conectar wizard con el adapter correcto (local mock vs remote OAuth). Sin esto, QuickstartWizard usaba siempre Remote y daba 503 en local.
setDefaultGitHubAuthPort(adapters.githubAuth)

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
