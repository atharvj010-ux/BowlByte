# BowlByte web app

Next.js application for the public site and the student, kitchen, cashier, and manager scaffolds.

```powershell
npm install
npm run dev
```

The dev server uses `http://localhost:8000` as the API origin unless `NEXT_PUBLIC_API_URL` is set.

```powershell
npm run lint
npm run typecheck
npm test
```

Playwright smoke tests expect a running site:

```powershell
npx playwright install chromium
npm run test:e2e
```

Accounts, ordering, cash recording, and notifications are not implemented. The status page reports the live API response.
