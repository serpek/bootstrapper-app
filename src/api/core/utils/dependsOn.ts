export function dependsOn(...dependencies: string[]) {
  return function (target: any) {
    Reflect.defineMetadata('dependencies', dependencies, target)
  }
}
