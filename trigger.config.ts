import "./scripts/load-env";
import { additionalFiles } from "@trigger.dev/build/extensions/core";
import { defineConfig } from "@trigger.dev/sdk";

const project = process.env.TRIGGER_PROJECT_REF;
if (!project) {
  throw new Error("TRIGGER_PROJECT_REF is not set (find it in your Trigger.dev project settings)");
}

export default defineConfig({
  project,
  dirs: ["./src/trigger"],
  runtime: "node",
  // Compute time per run. Time spent suspended on an approval does not count.
  maxDuration: 300,
  retries: {
    enabledInDev: true,
    default: {
      maxAttempts: 3,
      minTimeoutInMs: 1_000,
      maxTimeoutInMs: 30_000,
      factor: 2,
      randomize: true,
    },
  },
  build: {
    extensions: [additionalFiles({ files: ["./demo-data/**"] })],
  },
});
