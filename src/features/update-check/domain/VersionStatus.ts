/**
 * The result of comparing the running package version against the newest one
 * published to the registry. `latest` is null when it isn't known yet — no
 * network, the check is opted out, or the cache is empty — so a consumer can
 * distinguish "up to date" (updateAvailable:false, latest set) from "unknown"
 * (latest null) and stay silent in the unknown case.
 */
export type VersionStatus = {
  readonly current: string;
  readonly latest: string | null;
  readonly updateAvailable: boolean;
};
