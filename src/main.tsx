import 'reflect-metadata'

import { createRoot } from 'react-dom/client'
import { logService } from '@bipweb/common'
import { bootstrapper } from '@bipweb/core'

import App from './App'
import { ConnectionProvider } from './hooks'

import './index.css'

const log = logService.create({
  name: 'APP'
})

log.info('App initialize')

bootstrapper.initialize().then((container) => {
  createRoot(document.getElementById('root')!).render(
    <ConnectionProvider container={container}>
      <App />
      {/*<Example />*/}
    </ConnectionProvider>
  )
})
