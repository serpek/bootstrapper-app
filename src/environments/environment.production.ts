import { IApplicationConfiguration } from '@bipweb/common'

export const environment: IApplicationConfiguration = {
  // authApiAddress: 'https://pweb.bip.com/web/service',
  // authSocketAddress: 'wss://pa1.bip.com/ws/authv2',
  // configMode: 'prod',
  // debug: true,
  // domain: 'prp3.bip.com',
  // mobileResourceName: 'BipMobileClient',
  // publicUrl: window.location.origin,
  // webResourceName: 'BipSignalClient',
  // xmppSocketAddress: 'wss://pweb.bip.com/web/ws/',

  applicationName: 'BiP WEB PROD',
  authenticationApiUrl: 'https://pweb.bip.com/web/service',
  authenticationSocketUrl: 'wss://pa1.bip.com/ws/authv2',
  environmentMode: 'production',
  isDebugEnabled: true,
  primaryDomain: 'prp3.bip.com',
  mobileClientResourceName: 'BipMobileClient',
  publicBaseUrl: window.location.origin,
  resource: 'BipSignalClient',
  ttl: 3000,
  webClientResourceName: 'BipSignalClient',
  xmppWebSocketUrl: 'wss://pweb.bip.com/web/ws/'
}
