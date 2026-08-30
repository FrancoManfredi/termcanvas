import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/geist-sans/400.css'
import '@fontsource/geist-sans/500.css'
import '@fontsource/geist-mono/400.css'
import './index.css'
import App from './App.tsx'
import { WorkItemStoreProvider } from './lib/factory/store/WorkItemStoreContext.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <WorkItemStoreProvider>
      <App />
    </WorkItemStoreProvider>
  </StrictMode>,
)
