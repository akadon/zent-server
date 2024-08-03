// Custom epoch: 2024-01-01T00:00:00.000Z
const EPOCH = 1704067200000n;

const WORKER_BITS = 5n;
const PROCESS_BITS = 5n;
const INCREMENT_BITS = 12n;

const MAX_WORKER_ID = (1n << WORKER_BITS) - 1n;
const MAX_PROCESS_ID = (1n << PROCESS_BITS) - 1n;
const MAX_INCREMENT = (1n << INCREMENT_BITS) - 1n;

const WORKER_SHIFT = INCREMENT_BITS;
const PROCESS_SHIFT = INCREMENT_BITS + WORKER_BITS;
const TIMESTAMP_SHIFT = INCREMENT_BITS + WORKER_BITS + PROCESS_BITS;

export class SnowflakeGenerator {
  private workerId: bigint;
  private processId: bigint;
  private increment = 0n;
  private lastTimestamp = -1n;

  constructor(workerId: number = 1, processId: number = 1) {
    const wid = BigInt(workerId);
    const pid = BigInt(processId);
    if (wid < 0n || wid > MAX_WORKER_ID) {
      throw new Error(`Worker ID must be between 0 and ${MAX_WORKER_ID}`);
    }
    if (pid < 0n || pid > MAX_PROCESS_ID) {
      throw new Error(`Process ID must be between 0 and ${MAX_PROCESS_ID}`);
    }
    this.workerId = wid;
    this.processId = pid;
  }

  generate(): string {
    let timestamp = BigInt(Date.now()) - EPOCH;

    if (timestamp === this.lastTimestamp) {
      this.increment = (this.increment + 1n) & MAX_INCREMENT;
      if (this.increment === 0n) {
        // Wait for next millisecond
        while (timestamp <= this.lastTimestamp) {
          timestamp = BigInt(Date.now()) - EPOCH;
        }
      }
    } else {
      this.increment = 0n;
    }

    this.lastTimestamp = timestamp;

    const id =
      (timestamp << TIMESTAMP_SHIFT) |
      (this.processId << PROCESS_SHIFT) |
      (this.workerId << WORKER_SHIFT) |
      this.increment;

    return id.toString();
  }
}

export function deconstructSnowflake(snowflake: string) {
  const id = BigInt(snowflake);
  const timestamp = (id >> TIMESTAMP_SHIFT) + EPOCH;
  const processId = (id >> PROCESS_SHIFT) & MAX_PROCESS_ID;
  const workerId = (id >> WORKER_SHIFT) & MAX_WORKER_ID;
  const increment = id & MAX_INCREMENT;

  return {
    timestamp: new Date(Number(timestamp)),
    processId: Number(processId),
    workerId: Number(workerId),
    increment: Number(increment),
  };
}

export function snowflakeToDate(snowflake: string): Date {
  const id = BigInt(snowflake);
  const timestamp = (id >> TIMESTAMP_SHIFT) + EPOCH;
  return new Date(Number(timestamp));
}

// Singleton for use across the API
let _generator: SnowflakeGenerator | null = null;

export function initSnowflake(workerId: number, processId: number) {
  _generator = new SnowflakeGenerator(workerId, processId);
}

export function generateSnowflake(): string {
  if (!_generator) {
    _generator = new SnowflakeGenerator(1, 1);
  }
  return _generator.generate();
}
