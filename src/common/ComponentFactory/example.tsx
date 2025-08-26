import { Card, Col, Divider, Layout, Row } from 'antd'

import { addPlugin } from './AddPlugin'
import { BipComponentFactory } from './ComponentFactory'
import { GlobalStateProvider } from './UseGlobalState'

type CounterState = { count: number }

const Counter = BipComponentFactory({
  name: 'Counter',
  render: ({ globalState }) => {
    const [count, setCount] = globalState<number>('globalCount', 0)

    return (
      <div>
        <p>
          <strong>Global Count: {count}</strong>
        </p>
        <p>
          <button onClick={() => setCount(count + 1)}>+</button>
        </p>
      </div>
    )
  }
})

// Computed Properties Kullanımı
const ComputedCounter = BipComponentFactory<object, CounterState>({
  name: 'Counter',
  initialState: { count: 0 },
  render: ({ state, setState, computed }) => {
    const doubleCount = computed(() => state.count * 2, [state.count])

    return (
      <div>
        <p>
          <strong>Counter: {state.count}</strong>
        </p>
        <p>
          <strong>Double (Computed): {doubleCount}</strong>
        </p>
        <p>
          <button
            onClick={() => setState((prev) => ({ count: prev.count + 1 }))}>
            +
          </button>
        </p>
      </div>
    )
  }
})

// Event Sistemi Kullanımı
const Emitter = BipComponentFactory({
  name: 'Emitter',
  initialState: {},
  render: ({ emit }) => {
    return (
      <p>
        <button onClick={() => emit('customEvent', 'Merhaba Dünya!')}>
          Gönder
        </button>
      </p>
    )
  }
})

const Listener = BipComponentFactory({
  name: 'Listener',
  initialState: { message: '' },
  onMount: ({ on, setState }) => {
    on('customEvent', (data) => setState({ message: data }))
  },
  render: ({ state }) => {
    return <strong>Gelen Mesaj: {state.message}</strong>
  }
})

// Component Instance Kullanımı
const Parent = BipComponentFactory({
  name: 'Parent',
  initialState: {},
  render: ({ getInstance }) => {
    const child = getInstance('Child')

    return (
      <div>
        <strong>Parent Component</strong>
        <button onClick={() => child?.reset()}>Reset Child Count</button>
      </div>
    )
  }
})

const Child = BipComponentFactory<{ prop?: string }, CounterState>({
  name: 'Child',
  initialState: { count: 0 },
  methods: {
    reset: ({ setState }) => {
      setState({ count: 0 })
    }
  },
  render: ({ state, setState }) => {
    return (
      <div>
        <h2>Child Count: {state.count}</h2>
        <button onClick={() => setState((prev) => ({ count: prev.count + 1 }))}>
          +
        </button>
      </div>
    )
  }
})

//  State değiştiğinde konsola log yazsın
addPlugin((context) => {
  console.log(
    `[${context.name}] state değişti! state:`,
    context.state,
    ` | props:`,
    context.props
  )
})

// Bütün instance'lara otomatik olarak bir değer eklesin**
addPlugin((context) => {
  context.setState((prev: any) => ({
    ...prev,
    autoValue: 'Ben bir eklentiyim!'
  }))
})

// ✅ **Component Factory ile kullanımı**
const CounterWithPlugin = BipComponentFactory({
  name: 'Counter',
  initialState: { count: 0, autoValue: null },
  render: ({ state, setState }) => {
    return (
      <div>
        <p>
          <strong>Count: {state.count}</strong>
        </p>
        <p>
          <strong>Auto Value: {state.autoValue}</strong>{' '}
        </p>
        <button
          onClick={() =>
            setState((prev) => ({ ...prev, count: prev.count + 1 }))
          }>
          +
        </button>
      </div>
    )
  }
})

// Async Lifecycle Hooks Kullanımı
const DataFetcher = BipComponentFactory<
  object,
  { data: { title: string } | null; loading: boolean }
>({
  name: 'DataFetcher',
  initialState: { data: null, loading: true },

  // 🔥 **Bileşen Yüklenirken API Çağrısı Yapalım**
  async onMount({ setState }) {
    setState((prev) => ({ ...prev, loading: true }))

    const response = await fetch('https://jsonplaceholder.typicode.com/posts/1')
    const data = await response.json()

    setState({ data, loading: false })
  },

  render: ({ state }) => {
    if (state.loading) return <h2>Loading...</h2>
    return <h2>Fetched Data: {state.data?.title}</h2>
  }
})

export default function Example() {
  return (
    <GlobalStateProvider>
      <h1>Component Factory Example</h1>
      <Layout>
        <Row gutter={[16, 26]}>
          <Col span={12}>
            <Card title="Global State Kullanımı">
              <Counter />
              <Divider plain>
                İkinci Counter aynı global state'i paylaşır
              </Divider>
              <Counter />
            </Card>
          </Col>
          <Col span={12}>
            <Card title="Computed Properties Kullanımı">
              <ComputedCounter />
            </Card>
          </Col>
        </Row>
        <Row gutter={[16, 26]}>
          <Col span={12}>
            <Card title="Plugin Kullanımı">
              <CounterWithPlugin />
            </Card>
          </Col>
          <Col span={12}>
            <Card title="Event Sistemi Kullanımı">
              <Emitter />
              <Divider plain>Listener Component</Divider>
              <Listener />
            </Card>
          </Col>
        </Row>
        <Row gutter={[16, 26]}>
          <Col span={12}>
            <Card title="Component Instance Kullanımı">
              <Parent />
              <Divider plain>Child Component</Divider>
              <Child />
            </Card>
          </Col>
          <Col span={12}>
            <Card title="State Watcher">
              <DataFetcher />
            </Card>
          </Col>
        </Row>
      </Layout>
    </GlobalStateProvider>
  )
}
