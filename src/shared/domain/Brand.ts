declare const __brand: unique symbol;
export type Brand<T, B> = T & { readonly [__brand]: B };
