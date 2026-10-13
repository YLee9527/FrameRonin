export function requestImageGen(template: string) {
  window.dispatchEvent(new CustomEvent('frameronin:imagegen', { detail: template.replace('#imagegen/', '') }))
}
