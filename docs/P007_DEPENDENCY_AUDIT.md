# P007 dependency audit

## npm

`npm ls braces` shows `braces@3.0.3` only through `eslint-config-next@16.4.0` → `@next/eslint-plugin-next@16.4.0` → `fast-glob@3.3.1` → `micromatch@4.0.8`.

`npm audit` still reports 5 high findings, all GHSA-vfj7-8cjw-p6xm. `npm audit --omit=dev` reported 0 vulnerabilities. The packages are ESLint development tools. They do not run in the Next.js standalone server. `npm audit fix --force` would install `eslint-config-next` 14 and was not run. Next.js 16 was not downgraded.

Reassess when `eslint-config-next` 16 depends on a patched `braces` or `micromatch`. Until then the finding stays open and is not a production runtime exposure.

## Python

No new runtime package was added in P007. The forecast stack (scikit-learn, numpy, scipy, joblib) is unchanged from P006. A separate vulnerability scanner was not installed into the project. Treat "no new packages" as the P007 result, not as a claim that those libraries have zero advisories.
