import { parseChumpEvent } from "./events.ts";
import type {
  ChumpStatus,
  SteeringQueueItem,
  StoredEvent,
} from "./types.ts";

export type RemoteTurnHydration = {
  running: boolean;
  steeringQueue: SteeringQueueItem[];
  activityEvents: StoredEvent[];
  lastEventId: number;
};

/**
 * Reconcile status with the event-log snapshot that owns the replay cursor.
 *
 * A separately fetched status response can race a turn-status event. Once the
 * cursor advances past that event, using the stale status would leave the UI
 * permanently on the wrong side of the turn lifecycle boundary.
 */
export function resolveRemoteTurnHydration(
  status: ChumpStatus,
  events: readonly StoredEvent[],
): RemoteTurnHydration {
  let running = status.turn_running === true;
  let steeringQueue = status.steering_queue ?? [];
  let currentTurnStart = running ? 0 : events.length;
  let sawTurnStatus = false;

  for (const [index, event] of events.entries()) {
    const parsed = parseChumpEvent(event.type, event.data);
    if (parsed?.type === "turn_status") {
      sawTurnStatus = true;
      running = parsed.data.running;
      steeringQueue = parsed.data.steering_queue;
      currentTurnStart = running ? index + 1 : events.length;
      continue;
    }
    if (parsed?.type === "steering_queue") {
      steeringQueue = parsed.data.items;
    }
  }

  if (!sawTurnStatus && !running) {
    currentTurnStart = events.length;
  }

  return {
    running,
    steeringQueue,
    activityEvents: running
      ? events.slice(currentTurnStart).filter(isTurnActivityEvent)
      : [],
    lastEventId: Math.max(0, ...events.map((event) => event.id)),
  };
}

function isTurnActivityEvent(event: StoredEvent): boolean {
  return event.type === "assistant_text" ||
    event.type === "reasoning" ||
    event.type === "tool_call" ||
    event.type === "tool_result" ||
    event.type === "tool_execution.progress";
}
