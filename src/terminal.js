import readline from 'node:readline';

const MAX_STDIN_BYTES = 64 * 1024;

/** Reads a line without echoing it. Ctrl+C cancels. */
export function secretPrompt(question, input = process.stdin, output = process.stderr) {
  return new Promise((resolve, reject) => {
    output.write(question);
    const wasRaw = input.isRaw;
    readline.emitKeypressEvents(input);
    input.setRawMode(true);
    input.resume();
    let value = '';
    const finish = (error) => {
      input.removeListener('keypress', onKey);
      input.setRawMode(wasRaw);
      input.pause();
      output.write('\n');
      if (error) reject(error);
      else resolve(value);
    };
    const onKey = (str, key = {}) => {
      if (key.ctrl && (key.name === 'c' || key.name === 'd')) {
        const error = new Error('Cancelled.');
        error.cancelled = true;
        finish(error);
      } else if (key.name === 'return' || key.name === 'enter') {
        finish();
      } else if (key.name === 'backspace') {
        value = value.slice(0, -1);
      } else if (typeof str === 'string' && !key.ctrl && !key.meta && str >= ' ') {
        value += str;
      }
    };
    input.on('keypress', onKey);
  });
}

/** Asks a yes/no question; only "y" or "yes" counts as yes. */
export function confirmPrompt(question, input = process.stdin, output = process.stderr) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input, output, terminal: true });
    let answered = false;
    rl.on('close', () => {
      if (!answered) resolve(false);
    });
    rl.question(question, (answer) => {
      answered = true;
      rl.close();
      resolve(/^y(es)?$/i.test(answer.trim()));
    });
  });
}

/** Reads piped stdin, capped at 64 KiB. */
export async function readStdin(input = process.stdin) {
  const chunks = [];
  let total = 0;
  for await (const chunk of input) {
    total += chunk.length;
    if (total > MAX_STDIN_BYTES) throw new Error('stdin is larger than 64 KiB.');
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}
