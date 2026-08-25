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

/**
 * Is this runtime FRAMED by a host application (`?embed=1`)?
 *
 * The host's contract for "I own the chrome": the dashboard drops its header,
 * banners, tour, floating widgets and any self-promotion, so the frame reads as
 * one tab of the host instead of a second application nested inside it.
 * Independent from {@link isLyriksBrand}: a link opened in a NEW TAB from the
 * host carries the brand without the frame, and still needs its own chrome.
 */
export const isEmbedded = (url: URL | null | undefined): boolean =>
  url?.searchParams.get('embed') === '1';
