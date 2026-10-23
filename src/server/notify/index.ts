/**
 * Notification seam.
 *
 * The HTTP middleware starts the notification scheduler once per process.
 * Until the notification engine lands this is a no-op; it is replaced by the
 * polling webhook implementation in a later commit.
 */
export function startNotifyScheduler(_context: unknown): void {
  // Intentional no-op until the webhook notification engine is implemented.
}
