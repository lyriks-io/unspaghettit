import type { Brand } from '$shared/domain/Brand';

export type ProjectId = Brand<string, 'ProjectId'>;
export type StateVariableId = Brand<string, 'StateVariableId'>;

export const asProjectId = (v: string): ProjectId => v as ProjectId;
export const asStateVariableId = (v: string): StateVariableId => v as StateVariableId;
