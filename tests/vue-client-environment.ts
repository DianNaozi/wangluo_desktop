import { builtinEnvironments } from 'vitest/runtime'

const nodeEnvironment = builtinEnvironments.node

export default {
  ...nodeEnvironment,
  name: 'node-vue-client',
  viteEnvironment: 'client',
  setup(global: Record<string, unknown>, options: Record<string, unknown>) {
    global['self'] = global
    return nodeEnvironment.setup(global, options)
  }
}
