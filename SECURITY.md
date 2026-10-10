# Security policy

## Supported versions

Security fixes are made for the latest release only. The app tells you when a newer release is
available, and running the install command again updates it.

## Reporting a vulnerability

Please report security problems privately through GitHub: open the repository's **Security** tab
and choose **Report a vulnerability**. Don't open a public issue for security problems.

Include what you found, how to reproduce it, and which version and operating system you used.

## How releases are protected

- Release installers are built by GitHub Actions from the tagged commit.
- Every release includes `SHA256SUMS.txt`, and the install scripts refuse any file that does not
  match it.
- The app's page runs sandboxed with context isolation. It can only reach the main process through
  a small, typed API, and it may only ask for audio input.
