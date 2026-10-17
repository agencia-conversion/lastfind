# Contributing

Open an issue or pull request against `main`. Please include the problem, the change and relevant validation. Run `npm ci`, `npm run verify` and `npm run build:selfhost`. Tests must use isolated local data and mock provider tasks; never include keys, customer data or paid test calls.

This repository is a reviewed publication of Lastfind's shared source and personal application. Maintainers review contributions, import accepted patches into the canonical development source, test all supported editions and publish the accepted result here. Public pull requests are then closed with the published commit and contributor credit; they are not directly merged into this publication branch. This avoids maintaining divergent implementations.

Keep AGPL-3.0-only notices and attribution. Never include private service implementations or credentials. Never disclose working credentials in an issue. For vulnerabilities use the repository’s private security reporting option when enabled.

## Contribution agreement

By submitting a contribution, you confirm that you are its author and have the authority to grant these rights (including any required employer permission). You grant CONVERSION SERVICOS DE MARKETING PUBLICIDADE TECNOLOGIA E CONSULTORIA LTDA (Conversion) a perpetual, worldwide, non-exclusive, irrevocable, royalty-free license to use, reproduce, modify, distribute and sublicense your contribution, including the right to relicense it under other licenses, including commercial licenses. Conversion will keep the contribution available under AGPL-3.0-only. This grant does not transfer rights in third-party code that you do not own; identify any such material and its license for maintainer review.

To accept, check the contribution-agreement box in the pull request template. Public CI checks this acceptance on every pull request and after edits to its description. Maintainers verify authorship and acceptance before importing a contribution.
