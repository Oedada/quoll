import type React from 'react'

// заполняется один раз при старте приложения (см. App.tsx), до рендера
// любых компонентов, которые её используют - реактивность не нужна
export let Atomaro: Record<string, React.ComponentType<any>> = {}

export function setAtomaro(ns: Record<string, React.ComponentType<any>>) {
  Atomaro = ns
}
