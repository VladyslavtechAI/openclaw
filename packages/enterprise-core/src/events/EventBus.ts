import type { EventMap } from "./EventTypes.js";

type EventHandler<T> = (data: T) => void | Promise<void>;

interface Subscription {
  unsubscribe(): void;
}

/**
 * Typed event bus for inter-module communication.
 *
 * All handlers are invoked concurrently for a given event. If a handler throws,
 * the error is logged but does not prevent other handlers from running.
 */
export class EventBus {
  private readonly handlers = new Map<string, Set<EventHandler<unknown>>>();
  private readonly errorHandler: (error: unknown, event: string) => void;

  constructor(
    errorHandler?: (error: unknown, event: string) => void,
  ) {
    this.errorHandler =
      errorHandler ??
      ((err, evt) => {
        // eslint-disable-next-line no-console
        console.error(`[EventBus] handler error for "${evt}":`, err);
      });
  }

  on<K extends keyof EventMap>(
    event: K,
    handler: EventHandler<EventMap[K]>,
  ): Subscription {
    const key = event as string;
    let set = this.handlers.get(key);
    if (!set) {
      set = new Set();
      this.handlers.set(key, set);
    }
    const h = handler as EventHandler<unknown>;
    set.add(h);
    return {
      unsubscribe: () => {
        set!.delete(h);
        if (set!.size === 0) this.handlers.delete(key);
      },
    };
  }

  once<K extends keyof EventMap>(
    event: K,
    handler: EventHandler<EventMap[K]>,
  ): Subscription {
    const sub = this.on(event, (data) => {
      sub.unsubscribe();
      return handler(data);
    });
    return sub;
  }

  async emit<K extends keyof EventMap>(
    event: K,
    data: EventMap[K],
  ): Promise<void> {
    const set = this.handlers.get(event as string);
    if (!set || set.size === 0) return;

    const promises: Promise<void>[] = [];
    for (const handler of set) {
      try {
        const result = handler(data);
        if (result instanceof Promise) {
          promises.push(
            result.catch((err) =>
              this.errorHandler(err, event as string),
            ),
          );
        }
      } catch (err) {
        this.errorHandler(err, event as string);
      }
    }
    if (promises.length > 0) {
      await Promise.all(promises);
    }
  }

  listenerCount(event: keyof EventMap): number {
    return this.handlers.get(event as string)?.size ?? 0;
  }

  removeAllListeners(event?: keyof EventMap): void {
    if (event) {
      this.handlers.delete(event as string);
    } else {
      this.handlers.clear();
    }
  }
}
