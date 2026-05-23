import type { SurfaceBlueprint } from '../../../domain/entities/SurfaceBlueprint';
import { cartBlueprint } from './CartBlueprint';
import { catalogBlueprint } from './CatalogBlueprint';
import { checkoutBlueprint } from './CheckoutBlueprint';
import { orderConfirmationBlueprint } from './OrderConfirmationBlueprint';
import { productDetailsBlueprint } from './ProductDetailsBlueprint';

export const commerceBlueprints: readonly SurfaceBlueprint[] = [
  catalogBlueprint,
  productDetailsBlueprint,
  cartBlueprint,
  checkoutBlueprint,
  orderConfirmationBlueprint
];
