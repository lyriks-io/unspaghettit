/**
 * Is this runtime embedded under the Lyriks host?
 *
 * ONE definition, because the answer drives several independent chrome
 * decisions (the header lockup, the view switcher, the document title) and they
 * must agree. The signal is the `brand` query parameter, which the host sets and
 * `navigationContext` carries across same-origin navigations.
 *
 * Deliberately NOT the active theme. The Lyriks skin has been the DEFAULT theme
 * since 0.7.0, so `theme === 'lyriks'` is true for essentially every user and
 * says nothing about who owns the chrome — reading it as "we are inside the
 * Lyriks host" silently hid the Expert/Builder switcher from every standalone
 * install that had not opted into the classic theme.
 */
export const isLyriksBrand = (url: URL | null | undefined): boolean =>
  url?.searchParams.get('brand') === 'lyriks';
