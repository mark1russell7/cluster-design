/**
 * The worker of the view of the design space. A sweep of 500 designs takes approximately one second. Thus the sweep
 * operates here, and the page stays live. The page sends a ticket and an input, and the worker sends the ticket back with the result.
 */
import { sweepView, type ViewInput, type ViewResult } from "./design-view.ts";

/** This record is the message from the page: the ticket of the run and its input. */
export interface SweepRequest {
  readonly ticket: number;
  readonly input: ViewInput;
}

/** This record is the message to the page: the ticket of the run and its result. */
export interface SweepAnswer {
  readonly ticket: number;
  readonly result: ViewResult;
}

addEventListener("message", (event: MessageEvent<SweepRequest>) => {
  const { ticket, input } = event.data;
  const answer: SweepAnswer = { ticket, result: sweepView(input) };
  postMessage(answer);
});
