import { createHash } from 'node:crypto';
import { Harness, PASSWORD, buildOrg, hostOf, scoresFor, uniqueSlug, type TenantHandle } from '../support/harness';

type Archive = {
  tenantId: string;
  manifest: { section: string; rows: number; sha256: string }[];
  data: Record<string, Record<string, unknown>[]>;
  [k: string]: unknown;
};
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
const NEW_PASSWORD = 'Restored-pass-2026';
const sha = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** Re-signs one section's manifest entry, as an attacker who edits the file would. */
function resign(a: Archive, table: string) {
  const entry = a.manifest.find((m) => m.section.endsWith(`.${table}`))!;
  entry.rows = a.data[table]!.length;
  entry.sha256 = sha(a.data[table]);
}

/** ADR-016: restoring an export into a new tenant. */
describe('tenant restore from an export', () => {
  let h: Harness;
  let src: TenantHandle;
  let org: Awaited<ReturnType<typeof buildOrg>>;
  let archive: Archive;

  beforeAll(async () => {
    h = await Harness.start();
    src = await h.createTenant();
    org = await buildOrg(h, src);
    await h
      .as(src.host, org.emp1.token)
      .put(`/api/evaluations/${org.evalOf(org.emp1.id)}/self-scores`)
      .send(scoresFor(org.competencies, 4))
      .expect(200);
    await h.as(src.host, src.adminToken).post('/api/org/departments').send({ name: 'Research' }).expect(201);
    archive = (await h.as(src.host, src.adminToken).get('/api/tenant/export').expect(200)).body as Archive;
  });
  afterAll(() => h.close());

  const restore = (slug: string, a: Archive = archive, adminEmail = src.adminEmail) =>
    h
      .platform()
      .post('/api/platform/tenants/import')
      .send({ name: `Copy of ${src.slug}`, slug, admin: { email: adminEmail, password: NEW_PASSWORD }, archive: a });

  const slugIsFree = async (slug: string) =>
    !((await h.platform().get('/api/platform/tenants').expect(200)).body as { slug: string }[]).some((t) => t.slug === slug);

  describe('a faithful copy', () => {
    const slug = uniqueSlug('copy');
    let res: { tenant: { id: string }; report: { rows: number; remappedIds: number; sections: number }; durationMs: number };
    let adminToken: string;

    beforeAll(async () => {
      res = (await restore(slug).expect(201)).body;
      adminToken = (await h.login(slug, src.adminEmail, NEW_PASSWORD)).token;
    });

    it('answers with counts only, never with content', () => {
      const total = archive.manifest.reduce((n, m) => n + m.rows, 0);
      expect(res.report.rows).toBe(total);
      expect(res.report.sections).toBe(archive.manifest.length);
      expect(res.report.remappedIds).toBeGreaterThan(0);
      expect(JSON.stringify(res)).not.toContain(org.emp1.email);
    });

    it('the named admin signs in with the new password on the new sub-domain', async () => {
      const me = (await h.as(hostOf(slug), adminToken).get('/api/me/context').expect(200)).body;
      expect(me.user.email).toBe(src.adminEmail);
    });

    it('re-exporting the copy gives the same content under new identifiers', async () => {
      const copy = (await h.as(hostOf(slug), adminToken).get('/api/tenant/export').expect(200)).body as Archive;
      for (const m of archive.manifest) {
        const table = m.section.split('.')[1]!;
        if (table === 'audit_log') continue; // the copy's log also records the restore itself
        expect(copy.data[table]!.length, table).toBe(m.rows);
      }
      expect(copy.data['audit_log']!.length).toBeGreaterThan(archive.data['audit_log']!.length);
      const scores = (a: Archive) => a.data['evaluation_score']!.map((s) => s['score']).sort();
      expect(scores(copy)).toEqual(scores(archive));
      const emails = (a: Archive) => a.data['app_user']!.map((u) => u['email']).sort();
      expect(emails(copy)).toEqual(emails(archive));
    });

    it('shares no tenant-owned identifier with the source, which keeps working', async () => {
      const copy = (await h.as(hostOf(slug), adminToken).get('/api/tenant/export').expect(200)).body as Archive;
      const ids = (a: Archive) => new Set(JSON.stringify(a.data).match(UUID));
      const platformActors = new Set(archive.data['audit_log']!.filter((r) => r['actor_type'] === 'PLATFORM_ADMIN').map((r) => r['actor_id']));
      const requestIds = new Set(archive.data['audit_log']!.map((r) => r['request_id']));
      // Allowed overlaps: the platform operator as actor, original request ids in the copied log, and
      // the source tenant id recorded on purpose as provenance of the restore.
      const allowed = (id: string) => platformActors.has(id) || requestIds.has(id) || id === src.id;
      const shared = [...ids(copy)].filter((id) => ids(archive).has(id) && !allowed(id));
      expect(shared).toEqual([]);
      for (const rows of Object.values(copy.data)) for (const r of rows) expect(r['tenant_id']).toBe(res.tenant.id);
      await h.as(src.host, src.adminToken).get('/api/users').expect(200);
    });

    it('other users have no password until an admin sets one', async () => {
      const users = (await h.as(hostOf(slug), adminToken).get('/api/users?limit=50').expect(200)).body.items as {
        id: string;
        email: string;
        hasPassword: boolean;
      }[];
      const emp = users.find((u) => u.email === org.emp1.email)!;
      expect(emp.hasPassword).toBe(false);
      expect(users.find((u) => u.email === src.adminEmail)!.hasPassword).toBe(true);

      const denied = await h.as(hostOf(slug)).post('/api/auth/login').send({ email: emp.email, password: PASSWORD });
      expect(denied.status).toBe(401);
      expect(denied.body.code).toBe('INVALID_CREDENTIALS');

      await h.as(hostOf(slug), adminToken).post(`/api/users/${emp.id}/password`).send({ password: 'Temporary-pass-1' }).expect(200);
      await h.login(slug, emp.email, 'Temporary-pass-1');
      const audit = (await h.as(hostOf(slug), adminToken).get('/api/audit?action=iam.user.password_set').expect(200)).body.items[0];
      expect(audit.category).toBe('SECURITY');
      expect(JSON.stringify(audit)).not.toContain('Temporary-pass-1');
    });

    it('the restore is recorded in the new tenant’s own audit log', async () => {
      const entry = (await h.as(hostOf(slug), adminToken).get('/api/audit?action=platform.tenant.restored').expect(200)).body.items[0];
      expect(entry.metadata.sourceTenantId).toBe(src.id);
    });
  });

  it('refuses a modified archive and leaves nothing behind', async () => {
    const forged = clone(archive);
    forged.data['evaluation_score']![0]!['score'] = 1; // digest no longer matches
    const slug = uniqueSlug('forged');
    const res = await restore(slug, forged);
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('ARCHIVE_INVALID');
    expect(await slugIsFree(slug)).toBe(true);
  });

  it('refuses rows of another tenant even when the attacker re-signs the manifest', async () => {
    const forged = clone(archive);
    forged.data['department']![0]!['tenant_id'] = '01960000-0000-7000-8000-000000000000';
    resign(forged, 'department');
    const res = await restore(uniqueSlug('mixed'), forged);
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('ARCHIVE_MIXED_TENANTS');
  });

  it('refuses an archive that smuggles in a column that is never exported', async () => {
    const forged = clone(archive);
    forged.data['app_user']![0]!['password_hash'] = '$argon2id$v=19$m=19456,t=2,p=1$forged';
    resign(forged, 'app_user');
    const res = await restore(uniqueSlug('hash'), forged);
    expect(res.status).toBe(422);
    expect(res.body.errors ?? res.body.detail).toBeDefined();
  });

  it('refuses an incomplete archive', async () => {
    const forged = clone(archive);
    delete forged.data['competency'];
    forged.manifest = forged.manifest.filter((m) => !m.section.endsWith('.competency'));
    const res = await restore(uniqueSlug('partial'), forged);
    expect(res.status).toBe(422);
    expect(res.body.errors.some((e: { message: string }) => e.message.includes('competency'))).toBe(true);
  });

  it('is atomic: an admin e-mail that is not an admin of the archive rolls everything back', async () => {
    const slug = uniqueSlug('noadmin');
    const res = await restore(slug, archive, org.emp1.email);
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('ADMIN_NOT_IN_ARCHIVE');
    expect(await slugIsFree(slug)).toBe(true);
  });

  it('is an operator action: a tenant token cannot restore, and a taken slug is a 409', async () => {
    const asTenant = await h
      .as(src.host, src.adminToken)
      .post('/api/platform/tenants/import')
      .send({ name: 'X', slug: uniqueSlug(), admin: { email: src.adminEmail, password: NEW_PASSWORD }, archive });
    expect([401, 403, 404]).toContain(asTenant.status);
    expect((await restore(src.slug)).status).toBe(409);
  });

  it('a user may not set the password of someone more privileged', async () => {
    // The manager holds no user:write at all; the ceiling itself is covered by the RBAC suite.
    await h.as(src.host, org.manager.token).post(`/api/users/${src.adminId}/password`).send({ password: 'Takeover-pass-1' }).expect(403);
  });
});
