import { Harness, buildOrg, scoresFor, type TenantHandle } from '../support/harness';

/**
 * EV-01..EV-08 and the central claim of demo 2: the same request produces different, correct
 * behaviour per tenant purely from configuration (RQ3).
 */
describe('evaluation life-cycle driven by tenant policy', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await Harness.start();
  });
  afterAll(() => h.close());

  async function tenantWithPolicy(policy: Record<string, unknown>, plan = 'ENTERPRISE') {
    const t = await h.createTenant({ plan });
    await h.as(t.host, t.adminToken).put('/api/config/evaluation-policy').send(policy).expect(200);
    return { t, org: await buildOrg(h, t) };
  }

  it('one code, two behaviours: manager submit → MANAGER_SUBMITTED (approval) vs PUBLISHED (none)', async () => {
    const withApproval = await tenantWithPolicy({ selfAssessmentRequired: false, approvalRequired: true });
    const without = await tenantWithPolicy({ selfAssessmentRequired: false, approvalRequired: false });

    const submit = async ({ t, org }: { t: TenantHandle; org: Awaited<ReturnType<typeof buildOrg>> }) =>
      (
        await h
          .as(t.host, org.manager.token)
          .post(`/api/evaluations/${org.evalOf(org.emp1.id)}/manager-submit`)
          .send(scoresFor(org.competencies, 4))
          .expect(200)
      ).body;

    const a = await submit(withApproval);
    const b = await submit(without);
    expect(a.status).toBe('MANAGER_SUBMITTED');
    expect(b.status).toBe('PUBLISHED');
    expect(b.finalScore).toBe(75); // 4 on a 1–5 scale → 75/100
  });

  it('self-assessment is a step only where the policy requires it', async () => {
    const required = await tenantWithPolicy({ selfAssessmentRequired: true, approvalRequired: false });
    const off = await tenantWithPolicy({ selfAssessmentRequired: false, approvalRequired: false });

    // Required: the manager must wait for the employee.
    const early = await h
      .as(required.t.host, required.org.manager.token)
      .post(`/api/evaluations/${required.org.evalOf(required.org.emp1.id)}/manager-submit`)
      .send(scoresFor(required.org.competencies, 3));
    expect(early.status).toBe(422);
    expect(early.body.code).toBe('ILLEGAL_TRANSITION');

    // Not required: the self-assessment endpoint refuses.
    const self = await h
      .as(off.t.host, off.org.emp1.token)
      .post(`/api/evaluations/${off.org.evalOf(off.org.emp1.id)}/self-submit`)
      .send(scoresFor(off.org.competencies, 3));
    expect(self.status).toBe(422);
    expect(self.body.code).toBe('SELF_ASSESSMENT_DISABLED');
  });

  it('runs the full SINGLE-approval path with separation of duties and rejection', async () => {
    const { t, org } = await tenantWithPolicy({ selfAssessmentRequired: true, approvalRequired: true, approvalStrategy: 'SINGLE' });
    const id = org.evalOf(org.emp1.id);
    const emp = h.as(t.host, org.emp1.token);
    const mgr = h.as(t.host, org.manager.token);
    const admin = h.as(t.host, t.adminToken);

    expect((await emp.get(`/api/evaluations/${id}`).expect(200)).body.allowedActions).toEqual(['SAVE_SELF', 'SUBMIT_SELF']);
    await emp.put(`/api/evaluations/${id}/self-scores`).send(scoresFor(org.competencies.slice(0, 1), 5)).expect(200);
    // Incomplete self-assessment cannot be submitted.
    expect((await emp.post(`/api/evaluations/${id}/self-submit`).send({})).body.code).toBe('INCOMPLETE_SCORES');
    expect((await emp.post(`/api/evaluations/${id}/self-submit`).send(scoresFor(org.competencies, 5)).expect(200)).body.status).toBe(
      'SELF_SUBMITTED',
    );
    // Out-of-scale scores are rejected with a precise path.
    const bad = await mgr.post(`/api/evaluations/${id}/manager-submit`).send(scoresFor(org.competencies, 9));
    expect(bad.status).toBe(400);
    expect(bad.body.errors[0].path).toMatch(/^scores\.\d+\.score$/);

    expect((await mgr.post(`/api/evaluations/${id}/manager-submit`).send(scoresFor(org.competencies, 2)).expect(200)).body.status).toBe(
      'MANAGER_SUBMITTED',
    );
    // The evaluating manager cannot approve their own assessment, even with the permission.
    const selfApproval = await mgr.post(`/api/evaluations/${id}/approve`).send({});
    expect(selfApproval.status).toBe(403);

    // Admin rejects → back to the manager stage; then approves → published.
    expect((await admin.post(`/api/evaluations/${id}/reject`).send({ reason: 'Please add evidence' }).expect(200)).body.status).toBe(
      'SELF_SUBMITTED',
    );
    await mgr.post(`/api/evaluations/${id}/manager-submit`).send(scoresFor(org.competencies, 3)).expect(200);
    const published = (await admin.post(`/api/evaluations/${id}/approve`).send({ comment: 'ok' }).expect(200)).body;
    expect(published.status).toBe('PUBLISHED');
    expect(published.finalScore).toBe(50);
    expect(published.approvals.map((x: { decision: string }) => x.decision)).toEqual(['REJECTED', 'APPROVED']);

    // The employee sees the result after publishing (AFTER_PUBLISH).
    const seen = (await emp.get(`/api/evaluations/${id}`).expect(200)).body;
    expect(seen.finalScore).toBe(50);
    expect(seen.scores.some((s: { evaluator: string }) => s.evaluator === 'MANAGER')).toBe(true);

    const audit = (await admin.get(`/api/audit?entityType=evaluation&limit=100`).expect(200)).body.items.map((i: { action: string }) => i.action);
    expect(audit).toEqual(expect.arrayContaining(['evaluation.self_submitted', 'evaluation.manager_submitted', 'evaluation.rejected', 'evaluation.approved', 'evaluation.published']));
  });

  it('TWO_STAGE strategy needs two different approvers (customisation level 3)', async () => {
    const { t, org } = await tenantWithPolicy({ selfAssessmentRequired: false, approvalRequired: true, approvalStrategy: 'TWO_STAGE' });
    const reviewer = await h.addUser(t, 'reviewer', ['TENANT_ADMIN']);
    const id = org.evalOf(org.emp1.id);
    await h.as(t.host, org.manager.token).post(`/api/evaluations/${id}/manager-submit`).send(scoresFor(org.competencies, 5)).expect(200);

    const first = (await h.as(t.host, t.adminToken).post(`/api/evaluations/${id}/approve`).send({}).expect(200)).body;
    expect(first.status).toBe('PENDING_APPROVAL');
    const again = await h.as(t.host, t.adminToken).post(`/api/evaluations/${id}/approve`).send({});
    expect(again.status).toBe(403);
    expect(again.body.code).toBe('APPROVAL_NOT_ALLOWED');
    const second = (await h.as(t.host, reviewer.token).post(`/api/evaluations/${id}/approve`).send({}).expect(200)).body;
    expect(second.status).toBe('PUBLISHED');
    expect(second.approvals.map((a: { stage: number }) => a.stage)).toEqual([1, 2]);
  });

  it('a plan without TWO_STAGE refuses that policy (plan layer)', async () => {
    const t = await h.createTenant({ plan: 'STARTER' });
    const res = await h.as(t.host, t.adminToken).put('/api/config/evaluation-policy').send({ approvalRequired: true, approvalStrategy: 'TWO_STAGE' });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('PLAN_LIMIT');
  });

  it('MANAGERS_ONLY hides the result from the employee but not from the manager (EV-06)', async () => {
    const { t, org } = await tenantWithPolicy({ selfAssessmentRequired: false, approvalRequired: false, resultVisibility: 'MANAGERS_ONLY', scale: { min: 1, max: 10 } });
    const id = org.evalOf(org.emp1.id);
    const pub = (await h.as(t.host, org.manager.token).post(`/api/evaluations/${id}/manager-submit`).send(scoresFor(org.competencies, 10)).expect(200)).body;
    expect(pub.finalScore).toBe(100);
    const emp = (await h.as(t.host, org.emp1.token).get(`/api/evaluations/${id}`).expect(200)).body;
    expect(emp.status).toBe('PUBLISHED');
    expect(emp.finalScore).toBeNull();
    expect(emp.scores).toEqual([]);
    expect(emp.resultVisibleToEmployee).toBe(false);
  });

  it('scopes reads: other employees and other managers get 404, read-all sees everything', async () => {
    const { t, org } = await tenantWithPolicy({});
    const other = await h.addUser(t, 'othermgr', ['MANAGER'], t.adminId);
    const id = org.evalOf(org.emp1.id);
    await h.as(t.host, org.emp2.token).get(`/api/evaluations/${id}`).expect(404);
    await h.as(t.host, other.token).get(`/api/evaluations/${id}`).expect(404);
    await h.as(t.host, org.manager.token).get(`/api/evaluations/${id}`).expect(200);
    await h.as(t.host, t.adminToken).get(`/api/evaluations/${id}`).expect(200);
    // Lists follow the same scope.
    const team = (await h.as(t.host, org.manager.token).get('/api/evaluations?scope=team').expect(200)).body.items;
    expect(team.map((e: { employee: { id: string } }) => e.employee.id).sort()).toEqual([org.emp1.id, org.emp2.id].sort());
    await h.as(t.host, org.emp1.token).get('/api/evaluations?scope=all').expect(403);
    // History: own and direct reports only.
    await h.as(t.host, org.emp2.token).get(`/api/employees/${org.emp1.id}/evaluations`).expect(404);
    await h.as(t.host, org.manager.token).get(`/api/employees/${org.emp1.id}/evaluations`).expect(200);
  });

  it('freezes the policy into the cycle: changing the policy mid-cycle does not change running evaluations', async () => {
    const { t, org } = await tenantWithPolicy({ selfAssessmentRequired: false, approvalRequired: false });
    await h.as(t.host, t.adminToken).put('/api/config/evaluation-policy').send({ selfAssessmentRequired: true, approvalRequired: true }).expect(200);
    const res = (
      await h.as(t.host, org.manager.token).post(`/api/evaluations/${org.evalOf(org.emp1.id)}/manager-submit`).send(scoresFor(org.competencies, 3)).expect(200)
    ).body;
    expect(res.status).toBe('PUBLISHED'); // the cycle's snapshot, not the new policy
    // A new cycle picks up the new policy.
    const admin = h.as(t.host, t.adminToken);
    await admin.post(`/api/cycles/${org.cycle.id}/close`).expect(200);
    const next = (await admin.post('/api/cycles').send({ name: 'Cycle 2', startsOn: '2026-10-01' }).expect(201)).body;
    expect(next.policy.approvalRequired).toBe(true);
    expect(next.endsOn).toBe('2026-12-31'); // QUARTERLY default cadence
  });

  it('validates competencies (weights = 100) and only while the cycle is a draft', async () => {
    const t = await h.createTenant();
    const admin = h.as(t.host, t.adminToken);
    const cycle = (await admin.post('/api/cycles').send({ name: 'Draft', startsOn: '2026-07-01' }).expect(201)).body;
    const bad = await admin.put(`/api/cycles/${cycle.id}/competencies`).send({ competencies: [{ name: 'Only', weight: 90 }] });
    expect(bad.status).toBe(400);
    const ok = await admin
      .put(`/api/cycles/${cycle.id}/competencies`)
      .send({ competencies: [{ name: 'Impact', weight: 60 }, { name: 'Craft', weight: 40 }] })
      .expect(200);
    expect(ok.body.competencies.map((c: { weight: number }) => c.weight)).toEqual([60, 40]);
    await admin.post(`/api/cycles/${cycle.id}/activate`).expect(200);
    const late = await admin.put(`/api/cycles/${cycle.id}/competencies`).send({ competencies: [{ name: 'Late change', weight: 100 }] });
    expect(late.body.code).toBe('CYCLE_NOT_DRAFT');
    // Only one active cycle at a time.
    const second = (await admin.post('/api/cycles').send({ name: 'Second', startsOn: '2026-10-01' }).expect(201)).body;
    expect((await admin.post(`/api/cycles/${second.id}/activate`)).body.code).toBe('CYCLE_ALREADY_ACTIVE');
  });

  it('team dashboard and reports reflect published results (EV-08, RP-01, RP-03)', async () => {
    const { t, org } = await tenantWithPolicy({ selfAssessmentRequired: false, approvalRequired: false });
    const mgr = h.as(t.host, org.manager.token);
    await mgr.post(`/api/evaluations/${org.evalOf(org.emp1.id)}/manager-submit`).send(scoresFor(org.competencies, 5)).expect(200);
    await mgr.post(`/api/evaluations/${org.evalOf(org.emp2.id)}/manager-submit`).send(scoresFor(org.competencies, 1)).expect(200);

    const dash = (await mgr.get('/api/team/dashboard').expect(200)).body;
    expect(dash.byStatus.PUBLISHED).toBe(2);
    expect(dash.averageFinalScore).toBe(50);
    expect(dash.team).toHaveLength(2);

    const summary = (await h.as(t.host, t.adminToken).get('/api/reports/summary').expect(200)).body;
    expect(summary.published).toBe(2);
    expect(summary.maxFinalScore).toBe(100);
    expect(summary.minFinalScore).toBe(0);

    const analytics = (await h.as(t.host, t.adminToken).get('/api/analytics/overview').expect(200)).body;
    expect(analytics.distribution[0].count).toBe(1);
    expect(analytics.distribution[9].count).toBe(1);

    const csv = await h.as(t.host, t.adminToken).get('/api/reports/export.csv').expect(200);
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.text.split('\r\n')).toHaveLength(3);
  });

  it('refuses concurrent conflicting transitions (optimistic concurrency)', async () => {
    const { t, org } = await tenantWithPolicy({ selfAssessmentRequired: false, approvalRequired: false });
    const id = org.evalOf(org.emp1.id);
    const mgr = h.as(t.host, org.manager.token);
    const results = await Promise.all([
      mgr.post(`/api/evaluations/${id}/manager-submit`).send(scoresFor(org.competencies, 4)),
      mgr.post(`/api/evaluations/${id}/manager-submit`).send(scoresFor(org.competencies, 2)),
    ]);
    const statuses = results.map((r) => r.status).sort();
    expect(statuses[0]).toBe(200);
    expect([409, 422]).toContain(statuses[1]);
  });
});
