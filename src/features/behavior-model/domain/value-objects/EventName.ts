import type { Brand } from '$shared/domain/Brand';

export type EventName = Brand<string, 'EventName'>;

const EVENT_NAME_PATTERN = /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/;

export const isEventName = (v: string): v is EventName => EVENT_NAME_PATTERN.test(v);

export const asEventName = (v: string): EventName => {
  if (!isEventName(v)) {
    throw new Error(
      `Invalid event name "${v}". Use lowercase dot-separated form like "selection.deleted".`
    );
  }
  return v as EventName;
};
