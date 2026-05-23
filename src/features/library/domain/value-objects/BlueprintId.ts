import type { Brand } from '$shared/domain/Brand';

export type BlueprintId = Brand<string, 'BlueprintId'>;

export const asBlueprintId = (v: string): BlueprintId => v as BlueprintId;
