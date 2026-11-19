/**
 * Standalone page network hook for observing X's GraphQL traffic.
 *
 * Kept free of imports from the rest of PostNote so the extension's MAIN-world
 * content script (`page-hook.js`) bundles only this function.
 */

const GRAPHQL_MARKER = '/graphql/';

export type NetworkTarget = {
  fetch?: typeof fetch;
  XMLHttpRequest?: typeof XMLHttpRequest;
};

const watched = new WeakSet<object>();

/**
 * Patch `fetch` and `XMLHttpRequest` on `target` to forward `/graphql/`
 * response bodies to `onText`, without altering what the page receives.
 */
export function hookNetwork(target: NetworkTarget | null | undefined, onText: (text: string) => void): void {
  if (!target || watched.has(target)) return;
  watched.add(target);

  const originalFetch = target.fetch;
  if (typeof originalFetch === 'function') {
    target.fetch = function watchedFetch(
      this: unknown,
      ...args: Parameters<typeof fetch>
    ) {
      return originalFetch.apply(this, args).then((response) => {
        try {
          const url = String(response.url || (args[0] as Request)?.url || args[0]);
          if (url.includes(GRAPHQL_MARKER)) {
            response
              .clone()
              .text()
              .then((text) => {
                try {
                  onText(text);
                } catch {
                  // Observing is best effort; the page keeps working either way.
                }
              })
              .catch(() => undefined);
          }
        } catch {
          // Observing is best effort; the page keeps working either way.
        }
        return response;
      });
    } as typeof fetch;
  }

  const Xhr = target.XMLHttpRequest;
  if (typeof Xhr === 'function' && Xhr.prototype?.open) {
    const originalOpen = Xhr.prototype.open;
    Xhr.prototype.open = function watchedOpen(
      this: XMLHttpRequest,
      method: string,
      url: string | URL,
      ...rest: unknown[]
    ) {
      this.addEventListener('load', () => {
        try {
          if (String(url).includes(GRAPHQL_MARKER)) onText(this.responseText);
        } catch {
          // Same as above: never break the page's own request.
        }
      });
      return (originalOpen as (...a: unknown[]) => void).call(this, method, url, ...rest);
    } as typeof Xhr.prototype.open;
  }
}
