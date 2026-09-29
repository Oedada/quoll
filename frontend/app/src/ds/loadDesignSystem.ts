import React from 'react'
import * as ReactDOMClient from 'react-dom/client'
import * as ReactDOMMain from 'react-dom'

// бандлу нужны и createRoot (react-dom/client), и createPortal (react-dom) -
// в React 18 они живут в разных пакетах, а UMD-бандл ждёт их в одном объекте
const ReactDOM = { ...ReactDOMMain, ...ReactDOMClient }

// ds/_ds_bundle.js собран в UMD-стиле: ожидает window.React/window.ReactDOM
// и после исполнения кладёт компоненты в window.Atomaro. Порядок важен -
// бандл нельзя подключать через <script> в index.html: классический скрипт
// выполнится раньше отложенного type="module", и window.React ещё не будет готов.
declare global {
  interface Window {
    React: typeof React
    ReactDOM: typeof ReactDOM
    Atomaro: Record<string, React.ComponentType<any>>
  }
}

let loading: Promise<Record<string, React.ComponentType<any>>> | null = null

export function loadDesignSystem(): Promise<Record<string, React.ComponentType<any>>> {
  if (loading) return loading
  window.React = React
  window.ReactDOM = ReactDOM

  loading = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = '/ds/_ds_bundle.js'
    script.onload = () => resolve(window.Atomaro)
    script.onerror = () => reject(new Error('Не удалось загрузить дизайн-систему /ds/_ds_bundle.js'))
    document.head.appendChild(script)
  })
  return loading
}
