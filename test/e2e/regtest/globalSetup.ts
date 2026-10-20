// Starts a fresh regtest chain and the address-rewriting proxy for the run, and stops both after it.

import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { startProxy } from './proxy'

// A self-signed certificate for the proxy's wss:// instance, made per run and kept in memory only
function selfSignedCertificate() {
  const dir = mkdtempSync(join(tmpdir(), 'cashonize-e2e-'))
  try {
    execFileSync('openssl', [
      'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=127.0.0.1',
      '-addext', 'subjectAltName=IP:127.0.0.1', '-keyout', join(dir, 'key.pem'), '-out', join(dir, 'cert.pem'),
    ], { stdio: 'ignore' })
    return { key: readFileSync(join(dir, 'key.pem'), 'utf8'), cert: readFileSync(join(dir, 'cert.pem'), 'utf8') }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

export default function globalSetup() {
  const here = import.meta.dirname
  execFileSync(resolve(here, 'start.sh'), { stdio: 'inherit' })
  const proxy = startProxy(selfSignedCertificate())
  return async () => {
    await proxy.close()
    execFileSync(resolve(here, 'stop.sh'), { stdio: 'inherit' })
  }
}
