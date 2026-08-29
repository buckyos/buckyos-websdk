import { BuckyOSToolApplication } from './core/app.ts'
import type { ToolHost } from './runtime/host.ts'
import { installHost } from './runtime/host.ts'

export async function runCli(host: ToolHost, argv: string[]): Promise<number> {
  installHost(host)
  return await new BuckyOSToolApplication().run(argv)
}
