/// <reference lib="webworker" />
import { Planner, type PlanRequest } from "./planner";

export type { PlanRequest, PlanResponse, Quantiles, RouteStats } from "./planner";

const planner = new Planner();
self.onmessage = (event: MessageEvent<PlanRequest>) => {
  self.postMessage(planner.plan(event.data));
};
// the script loaded and started: a failure after this is not a start-up failure
self.postMessage({ ready: true });
