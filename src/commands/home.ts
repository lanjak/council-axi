import { loadConfig, listProviders } from '../config.js';
import { loadProvider } from '../providers/index.js';

export async function homeCommand(): Promise<void> {
  const config = loadConfig();
  const providers = listProviders(config);
  const lines: string[] = [];

  lines.push('council-axi: multi-LLM adversarial review council');
  lines.push(`providers[${providers.length}]{name,authenticated}:`);
  for (const name of providers) {
    const providerConfig = config.providers[name];
    const provider = loadProvider(name, providerConfig);
    const auth = await provider.checkAuth();
    lines.push(`  ${name},${auth.authenticated}`);
  }

  if (providers.length === 0) {
    lines.push('  (none configured)');
  }

  lines.push('commands[3]{name,purpose}:');
  lines.push('  setup,check provider authentication');
  lines.push('  review,adversarial review of an artifact or question');
  lines.push('  plan,pressure-test a plan or decision');

  lines.push('help[2]:');
  lines.push('  Set COUNCIL_PROVIDERS and per-provider env vars');
  lines.push('  Run `council-axi review "<prompt>" --models <provider1>,<provider2>`');

  console.log(lines.join('\n'));
}
