export class DependencyGraph {
  private initGraph = new Map<string, Set<string>>()

  /**
   * Bağımlılık ekleme
   */
  addInitDependency(service: string, dependsOn: string) {
    if (!this.initGraph.has(service)) {
      this.initGraph.set(service, new Set())
    }
    if (dependsOn) {
      this.initGraph.get(service)!.add(dependsOn)
    }
  }

  /**
   * Init sırasını belirle
   */
  getInitOrder(): string[] {
    const visited = new Set<string>()
    const tempMark = new Set<string>()
    const stack: string[] = []

    const visit = (node: string) => {
      if (tempMark.has(node))
        throw new Error(`Circular dependency detected at ${node}`)
      if (!visited.has(node)) {
        tempMark.add(node)
        const dependencies = this.initGraph.get(node) || new Set()
        for (const dep of dependencies) visit(dep)
        tempMark.delete(node)
        visited.add(node)
        stack.push(node)
      }
    }

    for (const node of this.initGraph.keys()) {
      visit(node)
    }

    return stack.reverse()
  }
}
