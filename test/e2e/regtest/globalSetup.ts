// Starts a fresh regtest chain and the address-rewriting proxy for the run, and stops both after it.

import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { startProxy } from './proxy'

export default function globalSetup() {
  const here = import.meta.dirname
  execFileSync(resolve(here, 'start.sh'), { stdio: 'inherit' })
  const proxy = startProxy()
  return async () => {
    await proxy.close()
    execFileSync(resolve(here, 'stop.sh'), { stdio: 'inherit' })
  }
}
