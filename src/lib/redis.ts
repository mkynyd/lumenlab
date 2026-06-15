import Redis from "ioredis";

const globalForRedis = globalThis as unknown as {
  redis: Redis | undefined;
};

function createRedis(): Redis {
  const client = new Redis(
    process.env.REDIS_URL || "redis://localhost:6379",
    {
      lazyConnect: true,
      connectTimeout: 800,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      retryStrategy(times) {
        return Math.min(times * 200, 2_000);
      },
    }
  );
  client.on("error", () => {
    // Consumers implement graceful fallback; prevent unhandled error events.
  });
  return client;
}

export function getRedis(): Redis {
  if (!globalForRedis.redis) {
    globalForRedis.redis = createRedis();
  }
  return globalForRedis.redis;
}

export async function checkRedisHealth(): Promise<boolean> {
  try {
    return (await getRedis().ping()) === "PONG";
  } catch {
    return false;
  }
}
