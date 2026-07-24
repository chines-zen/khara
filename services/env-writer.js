import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_PATH = path.join(__dirname, '..', '.env');

/**
 * Persist a single KEY=value pair to the project's local .env file and update
 * process.env so the change takes effect immediately (no restart needed).
 *
 * If the key already exists it is replaced in place; otherwise it is appended.
 * This is a local-development convenience — .env is not present/writable in a
 * real deployment, where these values come from the environment directly.
 *
 * @param {string} key
 * @param {string} value
 */
export async function setEnvVar(key, value) {
  let content = '';
  try {
    content = await fs.readFile(ENV_PATH, 'utf8');
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }

  const line = `${key}=${value}`;
  const existing = new RegExp(`^${key}=.*$`, 'm');

  if (existing.test(content)) {
    content = content.replace(existing, line);
  } else if (content.length === 0) {
    content = `${line}\n`;
  } else {
    content = content.endsWith('\n') ? `${content}${line}\n` : `${content}\n${line}\n`;
  }

  await fs.writeFile(ENV_PATH, content, 'utf8');
  process.env[key] = value;
}
