/** Explicit server integration; display branding must not change standalone behavior. */
export const hostOwnsStateDeletion = (): boolean => Boolean(process.env.UNSPA_HOST_URL?.trim());
