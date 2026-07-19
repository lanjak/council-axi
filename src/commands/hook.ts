import { loadConfig, listProviders } from '../config.js';
import { readStdinPayload } from '../stdin.js';
import { parseHookPayload } from '../hooks/payload.js';
import { resolveSessionKey, recordEdit } from '../hooks/state.js';

const EVENTS = ['session-start', 'post-edit', 'stop'] as const;
type HookEvent = (typeof EVENTS)[number];

export async function hookCommand(
  event: string | undefined,
  options: { payload?: string }
): Promise<void> {
  if (!event || !EVENTS.includes(event as HookEvent)) {
    console.error(
      `council-axi hook: unknown event "${event ?? '(none)'}"\navailable events: ${EVENTS.join(', ')}`
    );
    process.exitCode = 1;
    return;
  }

  const rawPayload = options.payload ?? (await readStdinPayload());

  switch (event as HookEvent) {
    case 'session-start':
      return sessionStart(rawPayload);
    case 'post-edit':
      return postEdit(rawPayload);
    case 'stop':
      // Implemented in Task 9 (gate).
      return stopPlaceholder(rawPayload);
  }
}

async function sessionStart(_rawPayload: string): Promise<void> {
  try {
    const config = loadConfig();
    const providers = listProviders(config);
    if (providers.length === 0) {
      return; // nothing configured: stay silent, exit 0
    }
    console.log(`council[available]: providers ${providers.join(',')} | review gate active`);
    console.log('help: run `council-axi review --diff "<question>"` for a council review');
  } catch {
    // A context hook must never break session startup.
  }
}

async function postEdit(rawPayload: string): Promise<void> {
  try {
    const payload = parseHookPayload(rawPayload);
    const cwd = payload.cwd ?? process.cwd();
    const key = resolveSessionKey(payload);
    for (const file of payload.files ?? []) {
      recordEdit(key, file, cwd);
    }
  } catch (err) {
    console.error(`council-axi hook post-edit: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function stopPlaceholder(_rawPayload: string): Promise<void> {
  // Replaced by the real gate in Task 9.
}
