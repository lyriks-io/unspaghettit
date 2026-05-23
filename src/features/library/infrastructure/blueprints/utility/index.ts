import type { SurfaceBlueprint } from '../../../domain/entities/SurfaceBlueprint';
import { canvasBlueprint } from './CanvasBlueprint';
import { cookieConsentBlueprint } from './CookieConsentBlueprint';
import { notFoundBlueprint } from './NotFoundBlueprint';
import { searchPaletteBlueprint } from './SearchPaletteBlueprint';
import { storeLocatorBlueprint } from './StoreLocatorBlueprint';
import { taskBoardBlueprint } from './TaskBoardBlueprint';

export const utilityBlueprints: readonly SurfaceBlueprint[] = [
  notFoundBlueprint,
  searchPaletteBlueprint,
  cookieConsentBlueprint,
  taskBoardBlueprint,
  storeLocatorBlueprint,
  canvasBlueprint
];
