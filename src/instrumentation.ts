import { appEnv, env } from "@/env";

// Fail at startup, with every missing variable listed, instead of on first use.
export function register() {
  env();
  appEnv();
}
