// Launching a headless browser, in two very different environments.
//
// Locally there is a real Chrome on the machine and the full `puppeteer`
// package, which ships its own browser. On Vercel there is neither: the
// lambda filesystem has no Chrome, and puppeteer's downloaded browser lives
// in a cache directory that is not part of the deployment. So serverless uses
// `puppeteer-core` driving @sparticuz/chromium, a Chromium build packaged for
// Lambda that unpacks itself into /tmp on first use.
//
// Both puppeteer and puppeteer-core are now pure ES modules, so they have to
// be loaded with dynamic import(). A plain require() throws
// "require() of ES Module ... not supported", which is exactly how this
// surfaced in production.

const fs = require('fs');

// Vercel sets VERCEL; any Lambda sets AWS_LAMBDA_FUNCTION_NAME.
const isServerless = () =>
  process.env.VERCEL === '1' || !!process.env.AWS_LAMBDA_FUNCTION_NAME;

const BASE_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-gpu',
  '--disable-blink-features=AutomationControlled',
];

async function launchServerless(log) {
  const [{ default: chromium }, puppeteer] = await Promise.all([
    import('@sparticuz/chromium'),
    import('puppeteer-core'),
  ]);
  const pptr = puppeteer.default || puppeteer;
  const executablePath = await chromium.executablePath();
  log(`Launching Chromium for serverless (${executablePath})`);

  const opts = {
    args: [...chromium.args, ...BASE_ARGS],
    defaultViewport: chromium.defaultViewport || { width: 1280, height: 800 },
    executablePath,
    headless: chromium.headless,
  };

  // ETXTBSY means the binary is still being written as we try to run it:
  // the package unpacks ~100 MB into /tmp, and on a cold start the write can
  // still be settling. It clears on its own, so retry briefly rather than
  // failing the whole crawl.
  const MAX = 4;
  for (let attempt = 1; ; attempt++) {
    try {
      return await pptr.launch(opts);
    } catch (err) {
      const busy = /ETXTBSY/.test(err && err.message ? err.message : '');
      if (!busy || attempt >= MAX) throw err;
      log(`Chromium still unpacking, retrying (${attempt}/${MAX - 1})`);
      await new Promise(r => setTimeout(r, 700 * attempt));
    }
  }
}

async function launchLocal(log, { visible = false } = {}) {
  const mod = await import('puppeteer');
  const puppeteer = mod.default || mod;

  const opts = visible
    ? {
        headless: false,
        defaultViewport: null,
        args: ['--window-size=1366,768', '--no-sandbox', '--disable-setuid-sandbox'],
      }
    : {
        headless: 'new',
        args: [...BASE_ARGS, '--window-size=1280,800'],
      };

  // Prefer puppeteer's own browser; fall back to an installed Chrome.
  const systemChrome = process.env.PUPPETEER_EXECUTABLE_PATH
    || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  try {
    const bundled = puppeteer.executablePath();
    if (!fs.existsSync(bundled) && fs.existsSync(systemChrome)) {
      opts.executablePath = systemChrome;
      log(`Using system Chrome: ${systemChrome}`);
    }
  } catch {
    if (fs.existsSync(systemChrome)) {
      opts.executablePath = systemChrome;
      log(`Using system Chrome: ${systemChrome}`);
    }
  }
  log('Launching headless browser');
  return puppeteer.launch(opts);
}

/**
 * @param {(msg: string) => void} [log] receives progress lines for the job log
 */
async function launchBrowser(log = () => {}, opts = {}) {
  // A visible window needs a display. There is none in a lambda, so say so
  // plainly rather than failing somewhere deep inside Chromium.
  if (opts.visible && isServerless()) {
    throw new Error(
      'Browser recording needs a visible browser window, which a serverless '
      + 'deployment cannot provide. Run QualChek locally to record a session.');
  }
  try {
    return isServerless() ? await launchServerless(log) : await launchLocal(log, opts);
  } catch (err) {
    // A raw module or binary error tells the person nothing they can act on.
    const detail = err && err.message ? err.message : String(err);
    throw new Error(
      isServerless()
        ? `Could not start a browser in this environment. ${detail}`
        : `Could not start a browser. Install Chrome, or set PUPPETEER_EXECUTABLE_PATH to it. ${detail}`
    );
  }
}

module.exports = { launchBrowser, isServerless };
