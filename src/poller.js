// -----------------------------------------------------------------------------
// Self-scheduling polling loop.
//
// The integration reads its TVs back on its own timer instead of relying on
// the Gladys scheduler: Gladys only polls a device created with
// `should_poll: true`, which the TVs users already created do not carry, and
// the Discovery tab offers no update for a change outside the features.
//
// Same idea as ../gladys-adguard-home/src/poller.js: a `setInterval` with an
// async body overlaps itself when a run outlasts the period (a few TVs timing
// out), so the next run is only scheduled once the previous one settled.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';

const logger = createLogger({ name: 'poller' });

export class Poller {
  /**
   * @param {object} deps - Dependencies.
   * @param {() => Promise<void>} deps.run - One poll.
   * @param {() => number} deps.interval - Delay in milliseconds between the end of a run and the
   * start of the next, read each time a run is scheduled.
   * @example
   * const poller = new Poller({ run: () => pollTelevisions(gladys), interval: () => 30000 });
   */
  constructor({ run, interval }) {
    this.run = run;
    this.interval = interval;
    this.timer = null;
    this.running = false;
    this.stopped = true;
  }

  /**
   * Poll now, then every `interval()` after the previous run settled. Calling
   * it while already started does nothing.
   * @returns {Promise<void>} Settles once the first run did; never rejects.
   * @example
   * poller.start();
   */
  async start() {
    if (!this.stopped) {
      return;
    }
    this.stopped = false;
    // A run left over from before a stop is still in flight: it schedules the
    // next one when it settles, starting another now would overlap it.
    if (!this.running) {
      await this.tick();
    }
  }

  /**
   * Cancel the next run; a run in flight finishes but schedules nothing.
   * @returns {void} Nothing.
   * @example
   * poller.stop();
   */
  stop() {
    this.stopped = true;
    this.cancelTimer();
  }

  /**
   * Schedule the pending run again with the current `interval()`, after a
   * configuration change. A run in flight picks it up when it settles.
   * @returns {void} Nothing.
   * @example
   * poller.rearm();
   */
  rearm() {
    if (this.timer !== null) {
      this.cancelTimer();
      this.schedule();
    }
  }

  async tick() {
    this.timer = null;
    this.running = true;
    try {
      await this.run();
    } catch (err) {
      // Called from a timer: a rejection here would end the process.
      logger.error('Polling run failed', err);
    } finally {
      this.running = false;
    }
    if (!this.stopped && this.timer === null) {
      this.schedule();
    }
  }

  schedule() {
    this.timer = setTimeout(() => this.tick(), this.interval());
  }

  cancelTimer() {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
