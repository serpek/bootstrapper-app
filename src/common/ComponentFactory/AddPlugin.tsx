export const plugins: Array<(context: any) => void> = []

export const addPlugin = (plugin: (context: any) => void) =>
  plugins.push(plugin)
