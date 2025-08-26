import { IApplicationConfiguration } from '@bipweb/common'

export const environment: IApplicationConfiguration = {
  // appName: 'BiP WEB MD PRP',
  // authApiAddress: 'https://pweb.bip.com/web/service',
  // authSocketAddress: 'wss://pa1.bip.com/ws/authv2',
  // configMode: 'prp',
  // debug: true,
  // domain: 'prp3.bip.com',
  // mobileResourceName: 'BipMobileClient',
  // publicUrl: window.location.origin,
  // webResourceName: 'BipSignalClient',
  // xmppSocketAddress: 'wss://pweb.bip.com/web/ws/',

  applicationName: 'BiP WEB PRP',
  authenticationApiUrl: 'https://pweb.bip.com/web/service',
  authenticationSocketUrl: 'wss://pa1.bip.com/ws/authv2',
  environmentMode: 'testing',
  isDebugEnabled: true,
  primaryDomain: 'prp3.bip.com',
  mobileClientResourceName: 'BipMobileClient',
  publicBaseUrl: window.location.origin,
  resource: 'BipSignalClient',
  ttl: 3000,
  webClientResourceName: 'BipSignalClient',
  xmppWebSocketUrl: 'wss://pweb.bip.com/web/ws/'
}
