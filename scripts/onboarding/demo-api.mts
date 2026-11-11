/**
 * The Duskora API for the onboarding walkthrough capture: the real app, with demo stand-ins for
 * the two outside services a first-time setup touches, so no real accounts or keys are needed.
 *
 * - GitHub: "Connect GitHub" goes straight back to the API's install callback for a demo
 *   installation on the `acme-labs` account with three demo repositories.
 * - Model keys: any key passes validation.
 * - Agent runs are not started (events only reach the browser), so capture.mjs can stage a
 *   ticket's progress through the board with demo data.
 *
 * Run from a Duskora checkout (DUSKORA_DIR), local Postgres up and migrated:
 *   cd $DUSKORA_DIR/apps/api && pnpm exec tsx --env-file=../../.env <this file>
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.env.DUSKORA_DIR ?? process.cwd().replace(/\/apps\/api$/, '');
const load = (p: string) => import(pathToFileURL(path.join(root, 'apps/api/src', p)).href);
const { createApp } = await load('app.ts');
const { loadConfig } = await load('config.ts');
const { buildDeps } = await load('deps.ts');
const { serve } = await import(
  pathToFileURL(createRequire(path.join(root, 'apps/api/package.json')).resolve('@hono/node-server'))
    .href
);

const port = Number(process.env.API_PORT ?? 4000);
const api = `http://localhost:${port}`;

const REPOS = [
  { id: 910001, fullName: 'acme-labs/storefront', defaultBranch: 'main', private: true },
  { id: 910002, fullName: 'acme-labs/api', defaultBranch: 'main', private: true },
  { id: 910003, fullName: 'acme-labs/mobile', defaultBranch: 'main', private: true },
];

const config = loadConfig();
const deps = await buildDeps(config);
deps.github = {
  installUrl: (state: string) =>
    `${api}/hooks/github/setup?installation_id=${4_200_000 + Math.floor(Math.random() * 99_999)}&setup_action=install&code=demo&state=${encodeURIComponent(state)}`,
  userCanAccessInstallation: async () => true,
  getInstallation: async (id: number) => ({
    id,
    accountLogin: 'acme-labs',
    accountType: 'Organization',
  }),
  listInstallationRepos: async () => REPOS,
  createRepoToken: async () => {
    throw new Error('demo: no GitHub tokens');
  },
  verifyWebhook: async () => false,
  repo: () => {
    throw new Error('demo: no GitHub repo operations');
  },
};
deps.validateKey = async () => ({ ok: true });
// Keep live updates for the browser, but start no agent runs: a ticket moved into Plan plays the
// demo timeline below instead, and approving it plays the deploy.
const forward = deps.realtime.forwarder.handle;
const playing = new Set<string>();
deps.events.publish = async (event: { detailType: string; detail: Record<string, unknown> }) => {
  await forward(event).catch(() => undefined);
  const { ticketId } = event.detail;
  if (typeof ticketId !== 'string') return;
  if (event.detailType === 'gate.decided' && event.detail.decision === 'approve') {
    void ship(ticketId).catch((err) => console.error('[demo] ship failed', err));
  } else if (!playing.has(ticketId)) {
    const ticket = await deps.db.ticket.findUnique({ where: { id: ticketId }, include: { stage: true } });
    if (ticket?.stage.role === 'PLAN' && !(await deps.db.run.count({ where: { ticketId } }))) {
      playing.add(ticketId);
      void play(ticketId).catch((err) => console.error('[demo] timeline failed', err));
    }
  }
};

const STEP_MS = Number(process.env.DEMO_STEP_MS ?? 650);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const db = deps.db;

const PLAN = `## Approach

Add a saved-items list next to the cart, backed by a \`saved_items\` table so it survives sign-out.

## Steps

1. **Migration** — \`saved_items (user_id, product_id, variant_id, saved_at)\` with a unique key on user + variant.
2. **API** — \`POST /cart/lines/:id/save\` moves a line into saved items; \`POST /saved/:id/restore\` moves it back. Both return the updated cart.
3. **Cart UI** — a "Save for later" button on each \`CartLine\`, and a \`SavedForLater\` list under the cart with "Move to cart".
4. **Guests** — keep saved items in local storage and merge them into the account on sign-in.
5. **Tests** — API tests for save/restore and the merge, and a Playwright test for the cart flow.

## Risks

- Restoring an item that is out of stock: show it as unavailable instead of failing.`;

const TIMELINE: Record<string, { model: string; cost: string; events: [string, string][]; outcome: Record<string, unknown> }> = {
  PLAN: {
    model: 'claude-haiku-5-5',
    cost: '0.0710',
    events: [
      ['status', 'Cloning acme-labs/storefront'],
      ['tool', 'Glob src/cart/**/*.tsx'],
      ['tool', 'Read src/cart/CartLine.tsx'],
      ['tool', 'Read src/api/routes/cart.ts'],
      ['tool', 'Grep localStorage'],
      ['text', 'The cart is server-backed for signed-in users and local for guests, so saved items need both paths.'],
      ['status', 'Plan ready: 5 steps'],
    ],
    outcome: { summary: 'Planned in 5 steps: migration, save/restore API, cart UI, guest merge on sign-in, and tests.' },
  },
  BUILD: {
    model: 'claude-sonnet-5-5',
    cost: '1.4200',
    events: [
      ['status', 'Cloning acme-labs/storefront'],
      ['status', 'Running the setup script (.duskora/setup.sh)'],
      ['tool', 'Write db/migrations/0042_saved_items.sql'],
      ['tool', 'Edit src/api/routes/cart.ts'],
      ['tool', 'Write src/cart/SavedForLater.tsx'],
      ['tool', 'Edit src/cart/CartLine.tsx'],
      ['tool', 'Edit src/auth/onSignIn.ts'],
      ['tool', 'Write tests/e2e/save-for-later.spec.ts'],
      ['tool', 'Bash pnpm test'],
      ['text', 'All 214 tests pass, including 9 new ones for saving, restoring and the guest merge.'],
      ['status', 'Pushing branch'],
      ['status', 'Opening pull request'],
    ],
    outcome: { summary: 'Opened #128: saved items table, save/restore endpoints, `SavedForLater` list and guest merge on sign-in. 9 new tests.' },
  },
  REVIEW: {
    model: 'claude-opus-5-5',
    cost: '0.6300',
    events: [
      ['tool', 'Bash git diff main...HEAD --stat'],
      ['tool', 'Read src/api/routes/cart.ts'],
      ['tool', 'Read src/auth/onSignIn.ts'],
      ['text', 'Restore checks stock and the unique key stops duplicates on a double click. Merge on sign-in is idempotent.'],
      ['status', 'Verdict: approved'],
    ],
    outcome: {
      verdict: 'approved',
      summary: 'Approved. The save/restore endpoints are transactional and the guest merge is idempotent. One nit left as a PR comment: the empty state could link to the catalogue.',
    },
  },
  QA: {
    model: 'claude-sonnet-5-5',
    cost: '0.8800',
    events: [
      ['status', 'Starting CI services: postgres'],
      ['tool', 'Bash pnpm install'],
      ['tool', 'Bash pnpm build'],
      ['tool', 'Bash pnpm lint'],
      ['tool', 'Bash pnpm exec playwright test save-for-later'],
      ['text', 'Each acceptance criterion is covered by a passing test.'],
      ['status', 'Finished: succeeded'],
    ],
    outcome: {
      summary: 'All 3 acceptance criteria met. Build, lint and the full test suite pass.',
      criteria: [
        { text: 'Each cart line has a "Save for later" button', result: 'met', tests: [{ file: 'tests/e2e/save-for-later.spec.ts', title: 'saves a cart line for later' }], media: [] },
        { text: 'Saved items show in a list under the cart and can be moved back', result: 'met', tests: [{ file: 'tests/e2e/save-for-later.spec.ts', title: 'moves a saved item back to the cart' }], media: [] },
        { text: 'Saved items persist across sessions for signed-in users', result: 'met', tests: [{ file: 'src/api/routes/cart.test.ts', title: 'keeps saved items after sign-out' }, { file: 'src/auth/onSignIn.test.ts', title: 'merges guest saved items on sign-in' }], media: [] },
      ],
    },
  },
};

const live = async (orgId: string, ticketId: string, runId?: string) =>
  forward({ detailType: 'run.updated', detail: { orgId, ticketId, ...(runId ? { runId } : {}) } });

const stageFor = async (ticketId: string, role: string) => {
  const t = await db.ticket.findUniqueOrThrow({ where: { id: ticketId }, include: { stage: true } });
  return db.stage.findFirstOrThrow({ where: { workflowId: t.stage.workflowId, role } });
};

const moveTo = async (ticketId: string, role: string) => {
  const stage = await stageFor(ticketId, role);
  await db.ticket.update({ where: { id: ticketId }, data: { stageId: stage.id } });
  return stage;
};

async function runStage(ticketId: string, role: keyof typeof TIMELINE) {
  const t = await db.ticket.findUniqueOrThrow({ where: { id: ticketId } });
  const stage = await moveTo(ticketId, role);
  const step = TIMELINE[role]!;
  const run = await db.run.create({
    data: { orgId: t.orgId, ticketId, stageId: stage.id, role, status: 'RUNNING', model: step.model, effort: role === 'REVIEW' ? 'high' : 'medium', startedAt: new Date() },
  });
  if (role === 'BUILD') {
    // The first Build run counts the ticket against the plan, as the orchestrator does.
    const sub = await db.subscription.findFirst({ where: { orgId: t.orgId } });
    const now = new Date();
    const periodStart = sub?.currentPeriodStart ?? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    await db.ticketUsage.createMany({ data: [{ orgId: t.orgId, ticketId, periodStart }], skipDuplicates: true });
  }
  await live(t.orgId, ticketId, run.id);
  let seq = 1;
  for (const [type, message] of step.events) {
    await sleep(STEP_MS);
    await db.runEvent.create({ data: { orgId: t.orgId, runId: run.id, seq: seq++, type, message } });
    await live(t.orgId, ticketId, run.id);
  }
  await db.run.update({
    where: { id: run.id },
    data: { status: 'SUCCEEDED', outcome: step.outcome, costUsd: step.cost, inputTokens: 180_000, outputTokens: 12_000, finishedAt: new Date() },
  });
  if (role === 'PLAN') await db.ticket.update({ where: { id: ticketId }, data: { plan: PLAN } });
  if (role === 'BUILD' && t.repoId) {
    await db.pullRequest.create({
      data: { orgId: t.orgId, ticketId, repoId: t.repoId, number: 128, branch: 'duskora/main-1-save-for-later', headSha: '9f3c2a1e7b', url: 'https://github.com/acme-labs/storefront/pull/128' },
    });
  }
  await live(t.orgId, ticketId, run.id);
  await sleep(STEP_MS * 2);
}

async function play(ticketId: string) {
  await sleep(STEP_MS * 2);
  for (const role of ['PLAN', 'BUILD', 'REVIEW', 'QA'] as const) await runStage(ticketId, role);
  const t = await db.ticket.findUniqueOrThrow({ where: { id: ticketId } });
  const stage = await moveTo(ticketId, 'APPROVAL');
  await db.gate.create({ data: { orgId: t.orgId, ticketId, stageId: stage.id, kind: 'APPROVAL' } });
  await forward({ detailType: 'gate.opened', detail: { orgId: t.orgId, ticketId } });
  playing.delete(ticketId);
}

async function ship(ticketId: string) {
  await sleep(300);
  const t = await db.ticket.findUniqueOrThrow({ where: { id: ticketId } });
  await moveTo(ticketId, 'DEPLOY');
  const dep = await db.deployment.create({
    data: { orgId: t.orgId, ticketId, repoId: t.repoId!, status: 'REBASING', detail: 'Rebasing onto main' },
  });
  for (const [status, detail] of [
    ['AWAITING_CHECKS', 'Waiting for CI on 4be81d0'],
    ['MERGING', 'Squash-merging #128'],
    ['AWAITING_DEPLOY', 'Merged as 7c1e9a4; watching the production deploy'],
  ] as const) {
    await forward({ detailType: 'deployment.updated', detail: { orgId: t.orgId, ticketId } });
    await sleep(STEP_MS * 2);
    await db.deployment.update({ where: { id: dep.id }, data: { status, detail, ...(status === 'AWAITING_DEPLOY' ? { mergeSha: '7c1e9a4f02' } : {}) } });
  }
  await forward({ detailType: 'deployment.updated', detail: { orgId: t.orgId, ticketId } });
  await sleep(STEP_MS * 2);
  await db.deployment.update({ where: { id: dep.id }, data: { status: 'SUCCEEDED', detail: 'Deployed to production' } });
  await db.pullRequest.update({ where: { ticketId }, data: { status: 'MERGED' } });
  await moveTo(ticketId, 'DONE');
  await forward({ detailType: 'ticket.moved', detail: { orgId: t.orgId, ticketId } });
}

serve({ fetch: createApp(deps).fetch, port }, () => console.info(`demo API on ${api}`));
