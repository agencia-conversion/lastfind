# Contributing

Open an issue or pull request against `main`. Please include the problem, the change and relevant validation. Run `npm ci`, `npm run verify` and `npm run build:selfhost`. Tests must use isolated local data and mock provider tasks; never include keys, customer data or paid test calls.

This repository is a reviewed publication of Lastfind's shared source and personal application. Maintainers review contributions, import accepted patches into the canonical development source, test all supported editions and publish the accepted result here. Public pull requests are then closed with the published commit and contributor credit; they are not directly merged into this publication branch. This avoids maintaining divergent implementations.

Keep Apache-2.0 notices and attribution. Never include private service implementations or credentials. Never disclose working credentials in an issue. For vulnerabilities use the repository’s private security reporting option when enabled.
