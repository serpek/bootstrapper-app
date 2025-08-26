import { z } from 'zod'

export const applicationConfigurationSchema = z.object({
  applicationName: z
    .string({
      description: 'Name of the application'
    })
    .min(1)
    .default('BiP WEB MD'),

  authenticationApiUrl: z
    .string({
      description: 'URL for the authentication API endpoint'
    })
    .url()
    .default('https://pweb.bip.com/web/service'),

  authenticationSocketUrl: z
    .string({
      description: 'WebSocket URL for authentication service'
    })
    .url()
    .default('wss://pa1.bip.com/ws/authv2'),

  environmentMode: z
    .enum(['development', 'production', 'testing'], {
      description: 'Operating environment mode of the application'
    })
    .default('development'),

  isDebugEnabled: z
    .boolean()
    .default(
      () => window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ),

  primaryDomain: z
    .string({
      description: 'Primary domain name for the service'
    })
    .min(1)
    .default('prp3.bip.com'),

  mobileClientResourceName: z
    .string({
      description: 'Resource identifier for the mobile client'
    })
    .min(1)
    .default('BipMobileClient'),

  publicBaseUrl: z
    .string({
      description: 'Public base URL for the application'
    })
    .url()
    .default(() => window.location.origin),

  resource: z
    .string({
      description: 'Main resource identifier'
    })
    .min(1)
    .default('BipSignalClient'),

  ttl: z
    .number({
      description: 'Time to live duration in seconds'
    })
    .min(1)
    .default(300),

  webClientResourceName: z
    .string({
      description: 'Resource identifier for the web client'
    })
    .min(1)
    .default('BipSignalClient'),

  xmppWebSocketUrl: z
    .string({
      description: 'WebSocket URL for XMPP connection'
    })
    .url()
    .default('wss://pweb.bip.com/web/ws/')
})

/*
import { type } from 'arktype'

export const ConfigSchema = type({
  appName: type.string.default('BiP WEB MD'),
  authApiAddress: type.string.default('https://pweb.bip.com/web/service'),
  authSocketAddress: type.string.default('wss://pa1.bip.com/ws/authv2'),
  configMode: type.string.default('dev'),
  debug: type.boolean.default(
    window.location.hostname === 'localhost' || window.location.hostname === ''
  ),
  domain: type.string.default('prp3.bip.com'),
  mobileResourceName: type.string.default('BipMobileClient'),
  publicUrl: type.string.default(window.location.origin),
  resource: type.string.default('BipSignalClient'),
  ttl: type.number.default(300),
  webResourceName: type.string.default('BipSignalClient'),
  xmppSocketAddress: type.string.default('wss://pweb.bip.com/web/ws/')
})

export type IConfig = typeof ConfigSchema.infer
*/
