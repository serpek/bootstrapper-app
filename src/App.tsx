import { useEffect } from 'react'
import { QRCodeCanvas } from 'qrcode.react'

import viteLogo from '/vite.svg'
import { State, Status } from '@bipweb/common'

import reactLogo from './assets/react.svg'
import { useConnection } from './hooks'

import './App.css'

function App() {
  const { authManager, session, networkStatsus } = useConnection()
  useEffect(() => {
    console.log(session)
  }, [session])

  return (
    <>
      <div>
        <a href="https://vite.dev" target="_blank">
          <img src={viteLogo} className="logo" alt="Vite logo" />
        </a>
        <a href="https://react.dev" target="_blank">
          <img src={reactLogo} className="logo react" alt="React logo" />
        </a>
      </div>
      <p>{session.qr && <QRCodeCanvas value={session.qr} />}</p>
      <p>Internet: {networkStatsus}</p>
      <p>Socket: {State[session.socket]}</p>
      <p>Status: {Status[session.status]}</p>
      <div className="card">
        <button
          style={{
            backgroundColor: session.socket === WebSocket.OPEN ? 'red' : 'green'
          }}
          onClick={() => {
            if (session.socket === WebSocket.OPEN) {
              authManager.close()
            } else {
              authManager.connect()
            }
          }}>
          {session.socket === WebSocket.OPEN ? 'Auth Close' : 'Auth Connect'}
        </button>
        <button
          disabled={session.socket !== State.OPEN}
          onClick={() => {
            if (session.socket === State.OPEN) {
              authManager.close()
            }
          }}>
          Close
        </button>
        <button
          disabled={session.socket === State.INIT}
          onClick={() => {
            console.log(session)
            if (session.socket !== State.INIT) {
              authManager.reconnect()
            }
          }}>
          reconnect
        </button>
      </div>
      <div>
        <button
          disabled={session.socket !== WebSocket.OPEN}
          onClick={() => {
            if (session.socket === WebSocket.OPEN) {
              authManager.logout()
            }
          }}>
          Logout
        </button>
      </div>
      <p className="read-the-docs">
        Click on the Vite and React logos to learn more
      </p>
    </>
  )
}

export default App
