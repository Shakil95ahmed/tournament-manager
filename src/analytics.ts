const GA_MEASUREMENT_ID = 'G-8QMXZ386KN';

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
  }
}

/**
 * Sends a GA4 page_view for client-side route changes.
 *
 * The Google tag loaded through Tag Manager reports the first page load on its
 * own, but GA4 cannot see hash-route changes (`#/t/abc`), so those page views
 * are sent manually with the current URL and document title.
 */
export function trackPageView(): void {
  if (typeof window.gtag !== 'function') return;

  window.gtag('event', 'page_view', {
    send_to: GA_MEASUREMENT_ID,
    page_location: window.location.href,
    page_title: document.title,
  });
}
