import { subscribe as subscribeShared } from '$shared/events/eventBus';
import type {
  SpecEvent,
  SpecEventBus,
  SpecEventListener
} from '../../application/ports/SpecEventBus';

/**
 * Concrete adapter that fulfils the SpecEventBus port using the shared
 * in-process eventBus. The translation is a one-to-one passthrough; the
 * adapter exists so the rest of the tutorial feature never imports from
 * `$shared/events/eventBus` directly — every cross-feature coupling
 * goes through this single seam.
 */
export class SharedSpecEventBusAdapter implements SpecEventBus {
  subscribe(listener: SpecEventListener): () => void {
    return subscribeShared((event): void => {
      const out: SpecEvent = event.payload
        ? { name: event.name, payload: event.payload }
        : { name: event.name };
      listener(out);
    });
  }
}
