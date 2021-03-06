// @flow
import Queue from './Queue';
import Client from './Client';
import Logger from './Logger';
import type { Env, LandRequest, StatusEvent } from './types';

export default class Runner {
  queue: Queue;
  running: ?LandRequest;
  locked: boolean;
  client: Client;
  paused: boolean;

  constructor(queue: Queue, client: Client) {
    this.queue = queue;
    this.running = null;
    this.locked = false;
    this.client = client;
    this.paused = true;
  }

  async next() {
    Logger.info(
      { running: this.running, locked: this.locked, queue: this.queue },
      'Next() called'
    );
    if (this.running || this.locked) return;
    let landRequest: ?LandRequest = this.queue.dequeue();
    if (!landRequest) return;
    this.locked = true;
    Logger.info({ landRequest }, 'Checking if still allowed to land...');

    let commit = await landRequest.commit;
    let isAllowedToLand = await this.client.isAllowedToLand(
      landRequest.pullRequestId
    );
    if (isAllowedToLand.isAllowed) {
      Logger.info({ landRequest }, 'Allowed to land, creating land build');
      const buildId = await this.client.createLandBuild(commit);
      this.running = { ...landRequest, buildId, buildStatus: 'PENDING' };
      this.locked = false;
      Logger.info({ running: this.running }, 'Land build now running');
    } else {
      Logger.info(
        { ...isAllowedToLand, ...landRequest },
        'Land request is not allowed to land'
      );
      this.locked = false;
      this.next();
    }
  }

  mergePassedBuildIfRunning(statusEvent: StatusEvent) {
    if (!this.running) {
      Logger.info(statusEvent, 'No build running, status event is irrelevant');
      return;
    }
    Logger.info(
      { statusEvent, running: this.running },
      'Status event May be relevant!'
    );
    if (statusEvent.buildId === this.running.buildId) {
      if (statusEvent.passed) {
        const pullRequestId = this.running.pullRequestId;
        Logger.info(
          { pullRequestId, running: this.running },
          'Merging pull request'
        );
        this.client.mergePullRequest(pullRequestId);
      } else {
        Logger.info(
          { running: this.running, statusEvent },
          'Land build failed'
        );
      }
      this.running = null;
      this.next();
    }
  }

  cancelCurrentlyRunningBuild() {
    if (!this.running) return;
    const cancelling = this.running;
    this.running = null;
    this.locked = false;
    if (cancelling.buildId) {
      this.client.stopLandBuild(cancelling.buildId);
    }
  }

  pause() {
    this.paused = true;
  }

  unpause() {
    this.paused = false;
  }

  enqueue(landRequest: LandRequest) {
    return this.queue.enqueue(landRequest);
  }

  removeLandReuqestByPullRequestId(pullRequestId: string) {
    this.queue.filter(
      (landRequest: LandRequest) => landRequest.pullRequestId !== pullRequestId
    );
  }

  getState() {
    return {
      queue: this.queue.list(),
      running: Object.assign({}, this.running),
      locked: this.locked
    };
  }
}
