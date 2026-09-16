/**
 * Accessors for `xstate.done.actor.*` / `xstate.error.actor.*` events inside
 * named actions, whose `event` parameter is typed as the machine's own union.
 */
export function doneOutput<T>(event: object): T {
  return (event as { output: T }).output;
}

export function actorError(event: object): unknown {
  return (event as { error: unknown }).error;
}

/** A readable message for an actor error, whatever was thrown. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
