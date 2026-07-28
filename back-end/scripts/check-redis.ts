import { redis } from "../src/database/redis.js";

async function main() {
  // Note: redis.keys() doesn't add keyPrefix, so we need to include it manually
  const prefix = "cbe:";
  const attemptKeys = await redis.keys(`${prefix}attempt:active:*`);
  console.log("attempt:active keys:", attemptKeys.length);

  const lockKeys = await redis.keys(`${prefix}session:lock:*`);
  console.log("session:lock keys:", lockKeys.length);

  const jtiKeys = await redis.keys(`${prefix}session:active_jti:*`);
  console.log("session:active_jti keys:", jtiKeys.length);

  // Check Redis info
  const info = await redis.info("memory");
  const usedMemory = info.match(/used_memory_human:(\S+)/)?.[1];
  const connectedClients = (await redis.info("clients")).match(
    /connected_clients:(\d+)/,
  )?.[1];
  console.log("Redis used_memory:", usedMemory);
  console.log("Redis connected_clients:", connectedClients);

  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
