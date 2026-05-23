export type Clock = () => string;

export const systemClock: Clock = () => new Date().toISOString();

export const fixedClock = (iso: string): Clock => () => iso;
