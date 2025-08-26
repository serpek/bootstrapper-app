export abstract class ServiceWrapper {
  isInitialized = false

  abstract init?(data?: unknown): void | Promise<void>

  abstract configure?(config: unknown): void | Promise<void>
}
