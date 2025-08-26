export class DependencyGraph {
  private dependencies = new Map<string | symbol, Set<string>>()

  addInitDependency(service: string | symbol, dependsOn: string) {
    if (!this.dependencies.has(service)) {
      this.dependencies.set(service, new Set())
    }
    if (dependsOn) {
      this.dependencies.get(service)!.add(dependsOn)
    }
  }

  getInitOrder(): (string | symbol)[] {
    const visited = new Set<string | symbol>()
    const tempMark = new Set<string | symbol>()
    const stack: (string | symbol)[] = []

    const visit = (node: string | symbol) => {
      if (tempMark.has(node))
        throw new Error(`Circular dependency detected at ${String(node)}`)
      if (!visited.has(node)) {
        tempMark.add(node)
        const _dependencies = this.dependencies.get(node) || new Set()
        for (const dep of _dependencies) visit(dep)
        tempMark.delete(node)
        visited.add(node)
        stack.push(node)
      }
    }

    for (const node of this.dependencies.keys()) {
      visit(node)
    }

    return stack
  }
}
