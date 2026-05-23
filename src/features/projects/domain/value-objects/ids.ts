import type { Brand } from '$shared/domain/Brand';

export type ProjectId = Brand<string, 'ProjectId'>;

export const asProjectId = (v: string): ProjectId => v as ProjectId;
