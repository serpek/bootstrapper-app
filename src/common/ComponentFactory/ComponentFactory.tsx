import React, {
  Dispatch,
  ReactNode,
  SetStateAction,
  useEffect,
  useReducer,
  useRef,
  useState
} from 'react'

import { plugins } from './AddPlugin'
import { emit, on } from './EventBus'
import { getInstance, instanceMap } from './GetInstance'
import { useComputed } from './UseComputed'
import { useGlobalState } from './UseGlobalState'

type ComponentContext<P, S> = {
  name: string
  props: P
  state: S
  setState: React.Dispatch<React.SetStateAction<S>>
  forceUpdate: () => void
  ref: React.RefObject<any>
  globalState: <T>(
    key: string,
    defaultValue: T
  ) => [T, Dispatch<SetStateAction<T>>]
  computed: <T>(fn: () => T, dependencies: any[]) => T
  emit: (eventName: string, data: any) => void
  on: (eventName: string, callback: (data: any) => void) => () => void
  getInstance: (name: string) => any
}

type LifecycleMethods<P, S> = {
  onMount?: (context: ComponentContext<P, S>) => Promise<void> | void
  onUpdate?: (
    context: ComponentContext<P, S>,
    prevProps: P
  ) => Promise<void> | void
  onUnmount?: (context: ComponentContext<P, S>) => Promise<void> | void
}

type ComponentFactoryOptions<P, S extends Record<string, any>> = {
  name: string
  initialState?: S
  render: (context: ComponentContext<P, S>) => ReactNode
  methods?: Record<string, (context: ComponentContext<P, S>) => void> // 🔥 Özel metodlar destekleniyor!
} & LifecycleMethods<P, S>

export function BipComponentFactory<
  P = object,
  S extends Record<string, any> = object
>(options: ComponentFactoryOptions<P, S>) {
  const {
    name,
    initialState = {} as S,
    render,
    onMount,
    onUpdate,
    onUnmount,
    methods = {}
  } = options

  const Component: React.FC<P> = (props) => {
    const [state, setState] = useState<S>(initialState)
    const [, forceRender] = useReducer((x) => x + 1, 0)
    const prevProps = useRef<P | null>(null)
    const ref = useRef<any>(null)

    const context: ComponentContext<P, S> = {
      name,
      props,
      state,
      setState,
      forceUpdate: () => forceRender(),
      ref,
      globalState: useGlobalState,
      computed: useComputed,
      emit,
      on,
      getInstance
    }

    Object.entries(methods).forEach(([key, fn]) => {
      ;(context as any)[key] = fn.bind(null, context)
    })

    useEffect(() => {
      plugins.forEach((plugin) => plugin(context))
    }, [])

    useEffect(() => {
      instanceMap.set(name, context)
      return () => {
        instanceMap.delete(name)
      }
    }, [name])

    useEffect(() => {
      if (onMount) Promise.resolve(onMount(context))
    }, [])

    useEffect(() => {
      if (prevProps.current && onUpdate) {
        Promise.resolve(onUpdate(context, prevProps.current))
      }
      prevProps.current = props
    }, [props, state])

    useEffect(() => {
      return () => {
        if (onUnmount) Promise.resolve(onUnmount(context))
      }
    }, [])

    return <>{render(context)}</>
  }

  Component.displayName = name
  return Component
}
