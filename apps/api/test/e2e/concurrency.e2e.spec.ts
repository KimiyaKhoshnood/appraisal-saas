import { Harness, buildOrg, scoresFor, type TenantHandle } from '../support/harness';

/** Conditional requests on evaluations (RFC 9110): ETag on reads, If-Match on writes. */
describe('optimistic concurrency over HTTP', () => {
  let h: Harness;
  let t: TenantHandle;
  let org: Awaited<ReturnType<typeof buildOrg>>;
  let id: string;

  beforeAll(async () => {
    h = await Harness.start();
    t = await h.createTenant();
    org = await buildOrg(h, t);
    id = org.evalOf(org.emp1.id);
  });
  afterAll(() => h.close());

  const emp = () => h.as(t.host, org.emp1.token);

  it('a read carries the version as a strong ETag, and If-None-Match gets 304', async () => {
    const res = await emp().get(`/api/evaluations/${id}`).expect(200);
    expect(res.headers['etag']).toBe(`"v${res.body.version}"`);
    await emp().get(`/api/evaluations/${id}`).set('If-None-Match', res.headers['etag']!).expect(304);
  });

  it('two tabs, one evaluation: the second save is refused with 412, nothing is overwritten', async () => {
    const read = await emp().get(`/api/evaluations/${id}`).expect(200);
    const etag = read.headers['etag']!;

    // Tab 1 saves with the ETag it read: accepted, new version.
    const first = await emp().put(`/api/evaluations/${id}/self-scores`).set('If-Match', etag).send(scoresFor(org.competencies, 4)).expect(200);
    expect(first.headers['etag']).toBe(`"v${read.body.version + 1}"`);

    // Tab 2 still holds the old ETag: refused, and the first save survives.
    const second = await emp().put(`/api/evaluations/${id}/self-scores`).set('If-Match', etag).send(scoresFor(org.competencies, 1));
    expect(second.status).toBe(412);
    expect(second.body.code).toBe('PRECONDITION_FAILED');
    const now = (await emp().get(`/api/evaluations/${id}`).expect(200)).body;
    expect(now.scores.every((s: { score: number }) => s.score === 4)).toBe(true);

    // After reloading, tab 2 can save.
    await emp().put(`/api/evaluations/${id}/self-scores`).set('If-Match', `"v${now.version}"`).send(scoresFor(org.competencies, 3)).expect(200);
  });

  it('a stale If-Match also guards state transitions', async () => {
    const stale = `"v${(await emp().get(`/api/evaluations/${id}`)).body.version - 1}"`;
    await emp().post(`/api/evaluations/${id}/self-submit`).set('If-Match', stale).send({}).expect(412);
  });

  it('a stranger gets 404, never a 412 that would confirm the evaluation exists', async () => {
    const res = await h.as(t.host, org.emp2.token).put(`/api/evaluations/${id}/self-scores`).set('If-Match', '"v0"').send(scoresFor(org.competencies, 2));
    expect(res.status).toBe(404);
  });

  it('a malformed entity tag is a 400; "*" and no header mean no precondition', async () => {
    const bad = await emp().put(`/api/evaluations/${id}/self-scores`).set('If-Match', 'v1').send(scoresFor(org.competencies, 3));
    expect(bad.status).toBe(400);
    expect(bad.body.errors[0].path).toBe('If-Match');
    await emp().put(`/api/evaluations/${id}/self-scores`).set('If-Match', '*').send(scoresFor(org.competencies, 3)).expect(200);
    await emp().put(`/api/evaluations/${id}/self-scores`).send(scoresFor(org.competencies, 3)).expect(200);
  });
});
