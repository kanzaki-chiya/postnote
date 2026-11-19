/**
 * The parts of the Chrome extension API PostNote uses, and nothing else.
 *
 * There is no `@types/chrome` dependency: the extension talks to the browser
 * through three members, so they are declared here and the surface that has to
 * be trusted stays small.
 */

declare namespace chrome {
  namespace runtime {
    /** Who sent a message; only the fields the listeners may look at. */
    interface MessageSender {
      readonly id?: string;
      readonly url?: string;
      readonly tab?: { readonly id?: number };
    }

    /**
     * Set by a call that failed; reading it is how Chrome clears it. Only
     * defined while a callback or promise handler of that call is running.
     */
    interface LastError {
      readonly message?: string;
    }

    const lastError: LastError | undefined;

    /**
     * Send one message to the extension's other contexts.
     *
     * Rejects when no listener answers, or when the answering listener throws.
     * The callback form is not declared because nothing here uses it.
     */
    function sendMessage<Response = unknown>(message: unknown): Promise<Response>;

    const onMessage: {
      /**
       * Listen for messages from other contexts. Returning `true` keeps the
       * channel open until `sendResponse` is called.
       */
      addListener(
        listener: (
          message: unknown,
          sender: MessageSender,
          sendResponse: (response?: unknown) => void,
        ) => boolean | void,
      ): void;
    };
  }
}
