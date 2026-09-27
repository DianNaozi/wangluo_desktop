export function shouldRestartVideo(queueLength: number, loop: boolean): boolean {
  return queueLength === 1 && loop
}
