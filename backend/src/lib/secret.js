// The JWT signing secret, in one place, checked once.
//
// This used to be `process.env.JWT_SECRET || 'testmanager-secret-key-change-in-production'`
// in two files. That default is committed to the repository, so any
// environment missing the variable would boot quietly and sign tokens with a
// value anyone can read - letting them forge a token for any account,
// including an admin. Nothing in the app would look wrong.
//
// A missing secret is therefore a startup failure, not something to paper
// over. Generating a random one instead is not an option either: on a
// serverless deployment each instance would invent its own, so tokens would
// fail whenever a request landed on a different one.

const PLACEHOLDER = 'testmanager-secret-key-change-in-production';
const MIN_LENGTH = 24;

function loadSecret() {
  const secret = (process.env.JWT_SECRET || '').trim();

  if (!secret) {
    throw new Error(
      'JWT_SECRET is not set. Generate one with:\n'
      + "  node -e \"console.log(require('crypto').randomBytes(48).toString('base64url'))\"\n"
      + 'then set it in backend/.env locally, or in the project environment variables when hosted.');
  }
  if (secret === PLACEHOLDER) {
    throw new Error(
      'JWT_SECRET is still the placeholder value from the repository. Anyone reading '
      + 'the source could forge a token for any account. Set a real random secret.');
  }
  // A warning, not a failure. Empty and placeholder are known-bad and safe to
  // refuse. Length is not: the secret already set in a hosted environment
  // cannot be read back, so throwing here would risk taking a working
  // deployment down over a secret that is merely shorter than ideal.
  if (secret.length < MIN_LENGTH) {
    console.warn(
      `WARNING: JWT_SECRET is ${secret.length} characters. At least ${MIN_LENGTH} random `
      + 'characters are recommended for HS256. Rotating it signs everyone out once.');
  }
  return secret;
}

module.exports = { JWT_SECRET: loadSecret() };
