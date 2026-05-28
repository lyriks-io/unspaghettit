import type { Parameter } from '../entities/Parameter';
import type { ValueSet } from '../entities/ValueSet';
import { parameterTypeToStateType } from '../value-objects/ParameterType';
import type { ParameterValidation } from '../value-objects/ParameterValidation';
import type { StateValue } from '../value-objects/StateValue';
import { isStateValueAssignableTo } from '../value-objects/StateValue';
import { effectiveEnumValues } from './EnumValues';

export type ParameterValues = { readonly [name: string]: StateValue };

export type ParameterError = {
  readonly parameterName: string;
  readonly reason: string;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IPV4_RE =
  /^((25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
// Permissive IPv6. Covers full and compressed forms; not RFC-perfect but
// catches the obvious invalid cases.
const IPV6_RE =
  /^(([0-9a-f]{1,4}:){7}[0-9a-f]{1,4}|([0-9a-f]{1,4}:){1,7}:|([0-9a-f]{1,4}:){1,6}:[0-9a-f]{1,4}|([0-9a-f]{1,4}:){1,5}(:[0-9a-f]{1,4}){1,2}|([0-9a-f]{1,4}:){1,4}(:[0-9a-f]{1,4}){1,3}|([0-9a-f]{1,4}:){1,3}(:[0-9a-f]{1,4}){1,4}|([0-9a-f]{1,4}:){1,2}(:[0-9a-f]{1,4}){1,5}|[0-9a-f]{1,4}:((:[0-9a-f]{1,4}){1,6})|:((:[0-9a-f]{1,4}){1,7}|:))$/i;
const HEX_RE = /^[0-9a-f]+$/i;
const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
// E.164: + followed by 1–15 digits, first digit not 0.
const PHONE_E164_RE = /^\+[1-9]\d{1,14}$/;
const COLOR_HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
// Subset of the official semver spec. Sufficient for typical use.
const SEMVER_RE =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_TIME_RE = /^\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/;
const ALPHANUM_RE = /^[A-Za-z0-9]+$/;
const ALPHA_RE = /^[A-Za-z]+$/;
const NO_WS_RE = /^\S+$/;

const isValidIsoDateTime = (value: string): boolean => {
  // Must look like a date+time and parse to a finite timestamp.
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?$/.test(value)) {
    return false;
  }
  const t = Date.parse(value);
  return Number.isFinite(t);
};

const checkValidation = (value: StateValue, v: ParameterValidation): string | null => {
  switch (v.type) {
    // ── presence ─────────────────────────────────────────────────────────
    case 'non_empty':
      if (typeof value === 'string' && value.length === 0) {
        return v.message ?? 'must not be empty';
      }
      return null;

    // ── string shape ─────────────────────────────────────────────────────
    case 'min_length':
      if (typeof value === 'string' && value.length < v.value) {
        return v.message ?? `must be at least ${v.value} characters`;
      }
      return null;
    case 'max_length':
      if (typeof value === 'string' && value.length > v.value) {
        return v.message ?? `must be at most ${v.value} characters`;
      }
      return null;
    case 'length':
      if (typeof value === 'string' && value.length !== v.value) {
        return v.message ?? `must be exactly ${v.value} characters`;
      }
      return null;
    case 'pattern':
      if (typeof value === 'string') {
        try {
          if (!new RegExp(v.value).test(value)) {
            return v.message ?? `must match pattern /${v.value}/`;
          }
        } catch {
          return `invalid regex pattern in validator: ${v.value}`;
        }
      }
      return null;
    case 'starts_with':
      if (typeof value === 'string' && !value.startsWith(v.value)) {
        return v.message ?? `must start with "${v.value}"`;
      }
      return null;
    case 'ends_with':
      if (typeof value === 'string' && !value.endsWith(v.value)) {
        return v.message ?? `must end with "${v.value}"`;
      }
      return null;
    case 'contains':
      if (typeof value === 'string' && !value.includes(v.value)) {
        return v.message ?? `must contain "${v.value}"`;
      }
      return null;
    case 'alphanumeric':
      if (typeof value === 'string' && !ALPHANUM_RE.test(value)) {
        return v.message ?? 'must be alphanumeric (letters and digits only)';
      }
      return null;
    case 'alphabetic':
      if (typeof value === 'string' && !ALPHA_RE.test(value)) {
        return v.message ?? 'must contain letters only';
      }
      return null;
    case 'lowercase':
      if (typeof value === 'string' && value !== value.toLowerCase()) {
        return v.message ?? 'must be lowercase';
      }
      return null;
    case 'uppercase':
      if (typeof value === 'string' && value !== value.toUpperCase()) {
        return v.message ?? 'must be uppercase';
      }
      return null;
    case 'no_whitespace':
      if (typeof value === 'string' && !NO_WS_RE.test(value)) {
        return v.message ?? 'must not contain whitespace';
      }
      return null;

    // ── string formats ───────────────────────────────────────────────────
    case 'email':
      if (typeof value === 'string' && !EMAIL_RE.test(value)) {
        return v.message ?? 'must be a valid email address';
      }
      return null;
    case 'url':
      if (typeof value === 'string') {
        try {
          new URL(value);
        } catch {
          return v.message ?? 'must be a valid URL';
        }
      }
      return null;
    case 'uuid':
      if (typeof value === 'string' && !UUID_RE.test(value)) {
        return v.message ?? 'must be a valid UUID';
      }
      return null;
    case 'ipv4':
      if (typeof value === 'string' && !IPV4_RE.test(value)) {
        return v.message ?? 'must be a valid IPv4 address';
      }
      return null;
    case 'ipv6':
      if (typeof value === 'string' && !IPV6_RE.test(value)) {
        return v.message ?? 'must be a valid IPv6 address';
      }
      return null;
    case 'hex':
      if (typeof value === 'string' && !HEX_RE.test(value)) {
        return v.message ?? 'must be a hex string';
      }
      return null;
    case 'base64':
      if (typeof value === 'string' && !BASE64_RE.test(value)) {
        return v.message ?? 'must be base64-encoded';
      }
      return null;
    case 'slug':
      if (typeof value === 'string' && !SLUG_RE.test(value)) {
        return v.message ?? 'must be a slug (lowercase letters, digits, hyphens)';
      }
      return null;
    case 'phone_e164':
      if (typeof value === 'string' && !PHONE_E164_RE.test(value)) {
        return v.message ?? 'must be an E.164 phone number (e.g. +33612345678)';
      }
      return null;
    case 'color_hex':
      if (typeof value === 'string' && !COLOR_HEX_RE.test(value)) {
        return v.message ?? 'must be a hex color (e.g. #1a2b3c)';
      }
      return null;
    case 'semver':
      if (typeof value === 'string' && !SEMVER_RE.test(value)) {
        return v.message ?? 'must be a SemVer version (e.g. 1.2.3)';
      }
      return null;
    case 'json':
      if (typeof value === 'string') {
        try {
          JSON.parse(value);
        } catch {
          return v.message ?? 'must be valid JSON';
        }
      }
      return null;
    case 'iso_date':
      if (typeof value === 'string') {
        if (!ISO_DATE_RE.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
          return v.message ?? 'must be an ISO date (YYYY-MM-DD)';
        }
      }
      return null;
    case 'iso_datetime':
      if (typeof value === 'string' && !isValidIsoDateTime(value)) {
        return v.message ?? 'must be an ISO datetime (e.g. 2026-05-08T12:00:00Z)';
      }
      return null;
    case 'iso_time':
      if (typeof value === 'string' && !ISO_TIME_RE.test(value)) {
        return v.message ?? 'must be an ISO time (HH:MM[:SS])';
      }
      return null;

    // ── number bounds ────────────────────────────────────────────────────
    case 'min':
      if (typeof value === 'number' && value < v.value) {
        return v.message ?? `must be ≥ ${v.value}`;
      }
      return null;
    case 'max':
      if (typeof value === 'number' && value > v.value) {
        return v.message ?? `must be ≤ ${v.value}`;
      }
      return null;
    case 'multiple_of':
      if (typeof value === 'number' && (v.value === 0 || value % v.value !== 0)) {
        return v.message ?? `must be a multiple of ${v.value}`;
      }
      return null;
    case 'integer':
      if (typeof value === 'number' && !Number.isInteger(value)) {
        return v.message ?? 'must be an integer';
      }
      return null;
    case 'finite':
      if (typeof value === 'number' && !Number.isFinite(value)) {
        return v.message ?? 'must be finite';
      }
      return null;
    case 'safe_integer':
      if (typeof value === 'number' && !Number.isSafeInteger(value)) {
        return v.message ?? 'must be a safe integer';
      }
      return null;
    case 'positive':
      if (typeof value === 'number' && value <= 0) {
        return v.message ?? 'must be positive';
      }
      return null;
    case 'negative':
      if (typeof value === 'number' && value >= 0) {
        return v.message ?? 'must be negative';
      }
      return null;
    case 'non_negative':
      if (typeof value === 'number' && value < 0) {
        return v.message ?? 'must be ≥ 0';
      }
      return null;
    case 'non_positive':
      if (typeof value === 'number' && value > 0) {
        return v.message ?? 'must be ≤ 0';
      }
      return null;
  }
};

export const validateParameters = (
  parameters: readonly Parameter[],
  values: ParameterValues,
  // Named value sets from the feature. Optional so existing callers compile
  // unchanged: a parameter that inlines `enumValues` validates without it; a
  // parameter that references a `valueSetId` is only enforced when the caller
  // (the simulator) threads the feature's value sets through.
  valueSets?: readonly ValueSet[]
): readonly ParameterError[] => {
  const errors: ParameterError[] = [];
  for (const parameter of parameters) {
    const value = values[parameter.name];
    if (value === undefined) {
      if (parameter.required && parameter.defaultValue === undefined) {
        errors.push({ parameterName: parameter.name, reason: 'is required' });
      }
      continue;
    }
    const baseType = parameterTypeToStateType(parameter.type);
    if (!isStateValueAssignableTo(value, baseType)) {
      errors.push({
        parameterName: parameter.name,
        reason: `expected ${parameter.type}, got ${typeof value}`
      });
      continue;
    }
    const allowedEnum =
      parameter.type === 'enum' ? effectiveEnumValues(parameter, valueSets) : undefined;
    if (allowedEnum && typeof value === 'string' && !allowedEnum.includes(value)) {
      errors.push({
        parameterName: parameter.name,
        reason: `must be one of ${allowedEnum.join(', ')}`
      });
      continue;
    }
    // Run zod-style validators. Stop after the first failure for a clearer
    // error message; the user can fix one issue at a time.
    if (parameter.validations) {
      for (const validation of parameter.validations) {
        const reason = checkValidation(value, validation);
        if (reason) {
          errors.push({ parameterName: parameter.name, reason });
          break;
        }
      }
    }
  }
  return errors;
};

export const fillDefaults = (
  parameters: readonly Parameter[],
  values: ParameterValues
): ParameterValues => {
  const next: { [k: string]: StateValue } = { ...values };
  for (const parameter of parameters) {
    if (next[parameter.name] === undefined && parameter.defaultValue !== undefined) {
      next[parameter.name] = parameter.defaultValue;
    }
  }
  return next;
};
