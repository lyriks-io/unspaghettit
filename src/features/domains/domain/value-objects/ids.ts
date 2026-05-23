import type { Brand } from '$shared/domain/Brand';

export type DomainId = Brand<string, 'DomainId'>;

export const asDomainId = (v: string): DomainId => v as DomainId;
