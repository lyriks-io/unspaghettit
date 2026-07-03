import type { SurfaceBlueprint } from '../../../domain/entities/SurfaceBlueprint';
import { authExtraBlueprints } from './extras';
import { resetPasswordBlueprint } from './ResetPasswordBlueprint';
import { signInBlueprint } from './SignInBlueprint';
import { signUpBlueprint } from './SignUpBlueprint';
import { verifyEmailBlueprint } from './VerifyEmailBlueprint';

/**
 * Standard auth quad: Sign in, Sign up, Verify email, Reset password.
 * Each blueprint references the others via `siblings` so the library UI can
 * offer "Add bundle" and so transitions wire up automatically.
 */
export const authBlueprints: readonly SurfaceBlueprint[] = [
  signInBlueprint,
  signUpBlueprint,
  verifyEmailBlueprint,
  resetPasswordBlueprint,
  ...authExtraBlueprints
];
