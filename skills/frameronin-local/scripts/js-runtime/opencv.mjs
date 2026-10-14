import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
const require = createRequire(import.meta.url)
const skill = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
let ready = null

export function loadOpenCv() {
  if (!ready) ready = initialize()
  return ready
}

async function initialize() {
  const cv = require(path.join(skill, 'assets/workbench/node_modules/@techstark/opencv-js'))
  // Emscripten's self-returning thenable cannot be assimilated by a native Promise.
  if (Object.hasOwn(cv, 'then')) delete cv.then
  const deadline = Date.now() + 15000
  while (Date.now() < deadline) {
    if (typeof cv.Mat === 'function') {
      const matrix = new cv.Mat(1, 1, cv.CV_8UC1)
      matrix.delete()
      return cv
    }
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  throw new Error('OPENCV_RUNTIME_INITIALIZATION_TIMEOUT')
}
