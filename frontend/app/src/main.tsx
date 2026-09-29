import { StrictMode } from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter } from 'react-router-dom'
import { loadDesignSystem } from './ds/loadDesignSystem'
import { setAtomaro } from './ds/atomaro'
import { setUnauthorizedHandler } from './api/client'
import { queryClient } from './queryClient'
import { App } from './app/App'
import { ToastProvider } from './manager/ToastProvider'
import './global.css'

setUnauthorizedHandler(() => {
  queryClient.invalidateQueries({ queryKey: ['me'] })
})

loadDesignSystem().then((ns) => {
  setAtomaro(ns)
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <ToastProvider>
            <App />
          </ToastProvider>
        </BrowserRouter>
      </QueryClientProvider>
    </StrictMode>,
  )
})
