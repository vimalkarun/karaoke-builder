import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs'
import path from 'node:path'

// HTTPS is required for microphone access (Practice mode) from anything
// other than exactly `localhost` — browsers block getUserMedia on insecure
// origins, which plain http://<lan-ip>:5173 always is. Loads the same
// self-signed cert the backend uses (see backend/scripts/generate_dev_cert.py)
// if it's been generated; falls back to plain HTTP otherwise so a fresh
// checkout still runs without extra setup.
const certPath = path.resolve(__dirname, '../backend/certs/cert.pem')
const keyPath = path.resolve(__dirname, '../backend/certs/key.pem')
const hasCerts = fs.existsSync(certPath) && fs.existsSync(keyPath)

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Listen on all interfaces, not just localhost — required to be
    // reachable from a phone over LAN at all.
    host: true,
    https: hasCerts ? { cert: fs.readFileSync(certPath), key: fs.readFileSync(keyPath) } : undefined,
  },
})
