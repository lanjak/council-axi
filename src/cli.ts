#!/usr/bin/env node
import { program, CommanderError } from 'commander';
import { reviewCommand } from './commands/review.js';
import { planCommand } from './commands/plan.js';
import { debateCommand, debateTurnCommand, debateAbortCommand } from './commands/debate.js';
import { setupCommand } from './commands/setup.js';
import { homeCommand } from './commands/home.js';
import { hookCommand } from './commands/hook.js';
import { formatError } from './errors.js';

program
  .name('council-axi')
  .description('Multi-LLM adversarial review council - an AXI')
  .version('0.2.0')
  .exitOverride()
  .configureOutput({
    writeOut: (str: string) => process.stdout.write(str),
    writeErr: () => {},
  });

program
  .command('setup')
  .description('Check provider authentication status')
  .action(setupCommand);

function collect(value: string, previous: string[]): string[] {
  return previous.concat([value]);
}

program
  .command('review <prompt>')
  .description('Run an adversarial review of an artifact or question')
  .option('-m, --models <models>', 'Comma-separated provider list')
  .option('-f, --file <path>', 'Attach a file or directory (repeatable)', collect, [])
  .option('--diff [range]', 'Attach git diff (default: HEAD)')
  .option('--stdin', 'Attach artifact content from stdin')
  .action(reviewCommand);

program
  .command('plan <prompt>')
  .description('Pressure-test a plan or decision')
  .option('-m, --models <models>', 'Comma-separated provider list')
  .option('-f, --file <path>', 'Attach a file or directory (repeatable)', collect, [])
  .option('--diff [range]', 'Attach git diff (default: HEAD)')
  .option('--stdin', 'Attach artifact content from stdin')
  .action(planCommand);

const debate = program
  .command('debate')
  .description('Run a sequential adversarial debate until consensus or round cap');

debate
  .command('run <prompt>', { isDefault: true, hidden: true })
  .option('-m, --models <models>', 'Comma-separated provider list')
  .option('--max-rounds <n>', 'Maximum debate rounds (default: 5)')
  .option('--full', 'Include the complete round-by-round transcript')
  .option('--participate', 'Join the debate as a participant (resumable session)')
  .option('-f, --file <path>', 'Attach a file or directory (repeatable)', collect, [])
  .option('--diff [range]', 'Attach git diff (default: HEAD)')
  .option('--stdin', 'Attach artifact content from stdin')
  .action(debateCommand);

debate
  .command('turn <session-id> [response]')
  .description('Submit your turn in a paused participating debate')
  .option('--stdin', 'Read the turn from stdin')
  .option('--full', 'Include the complete transcript in the final output')
  .action(debateTurnCommand);

debate
  .command('abort <session-id>')
  .description('Delete a paused debate session')
  .action(debateAbortCommand);

program
  .command('hook [event]')
  .description('Harness lifecycle hook entrypoint (session-start|post-edit|stop)')
  .option('--payload <json>', 'hook payload as JSON (alternative to stdin)')
  .action(hookCommand);

async function main(): Promise<void> {
  if (process.argv.length <= 2) {
    await homeCommand();
    return;
  }
  await program.parseAsync(process.argv);
}

main().catch((err) => {
  if (err instanceof CommanderError) {
    if (err.code === 'commander.helpDisplayed' || err.code === 'commander.version') {
      process.exit(0);
    }
    console.log(`${err.message.trim()}\nhelp: npx -y council-axi --help`);
    process.exit(2);
  }
  console.log(formatError(err));
  process.exit(1);
});
