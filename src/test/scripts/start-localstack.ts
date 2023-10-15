#!/usr/bin/env ts-node-script

import { sync } from "cross-spawn";
import * as url from 'node:url';
import * as path from "path";
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT_DIR = path.join(__dirname, "../../..");

/** LocalStack uses bridge mode networking, so the "dockerize" pattern doesn't work */
export async function startLocalStack() {
  // Use "--env-file" ".env" to pass the .env contents to docker (though this is not necessary)
  const { status } = sync("docker-compose", ["up", "-d", "localstack"], {
    cwd: ROOT_DIR,
  });
  if (status !== 0) {
    throw new Error("Failed to start docker-compose!");
  }

  await waitForLocalStack();
}

async function waitForLocalStack() {
  while (true) {
    const { status } = sync("curl", ["http://localhost:4566"]);
    if (status !== 0) {
      console.info("LocalStack is not ready. Waiting 2 seconds...");
      await new Promise((resolve) => setTimeout(resolve, 2000));
    } else {
      console.info("LocalStack is up!");
      break;
    }
  }
}

function requireMain(callback: () => void): void {
  if (import.meta.url.startsWith('file:')) { // (A)
      const modulePath = url.fileURLToPath(import.meta.url);
      if (process.argv[1] === modulePath) { // (B)
        // Main ESM module
        callback();
      }
  }
}

requireMain(startLocalStack)
