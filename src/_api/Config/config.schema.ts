import { type } from 'arktype'
/*
export const ConfigSchema = z.object({
  appName: z.string({ description: '' }).default('BiP WEB MD'),
  authApiAddress: z
    .string({ description: '' })
    .url()
    .default('https://pweb.bip.com/web/service'),
  authSocketAddress: z
    .string({ description: '' })
    .url()
    .default('wss://pa1.bip.com/ws/authv2'),
  configMode: z.string().default('dev'),
  debug: z
    .boolean()
    .default(
      window.location.hostname === 'localhost' ||
        window.location.hostname === '127.0.0.1'
    ),
  domain: z.string().default('prp3.bip.com'),
  mobileResourceName: z.string({ description: '' }).default('BipMobileClient'),
  publicUrl: z
    .string({ description: '' })
    .url()
    .default(window.location.origin),
  resource: z.string({ description: '' }).default('BipSignalClient'),
  webResourceName: z.string({ description: '' }).default('BipSignalClient'),
  xmppSocketAddress: z
    .string({ description: '' })
    .url()
    .default('wss://pweb.bip.com/web/ws/')
})

export type IConfig = z.infer<typeof ConfigSchema>
*/

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
