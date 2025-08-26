export class ServiceContainerError extends Error {
  constructor(
    message: string,
    public context?: any
  ) {
    super(message)
    this.name = 'ServiceContainerError'
  }
}
