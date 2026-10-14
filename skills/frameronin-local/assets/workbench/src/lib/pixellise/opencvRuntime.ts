import cv from '@techstark/opencv-js'

// Expose a function instead of re-exporting the Emscripten object. Its `then`
// method must never be copied onto a dynamic-import namespace by bundlers.
export function getOpenCvRuntime(): unknown {
  return cv
}
