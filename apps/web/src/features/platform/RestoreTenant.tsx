import { useState, type ChangeEvent, type FormEvent } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArchiveRestore, FileJson, ShieldCheck } from 'lucide-react';
import { PLAN_CODES, type TenantSummary } from '@appraisal/contracts';
import { ApiError, platformApi } from '../../shared/lib/api';
import { qk } from '../../shared/lib/query-keys';
import { Badge, Button, Card, ErrorBox, Field, Input, Page, PageHeader, Select, fadeUp } from '../../shared/ui';

interface Archive {
  format: string;
  version: number;
  tenantId: string;
  exportedAt?: string;
  tenant?: { slug?: string; name?: string; plan?: string };
  manifest: { section: string; rows: number; sha256: string }[];
  data: Record<string, unknown[]>;
}

interface RestoreResponse {
  tenant: TenantSummary;
  durationMs: number;
  report: { sections: number; rows: number; remappedIds: number };
}

/**
 * ADR-016: restore an organisation's export into a new tenant. The file is read in the browser
 * only to show its manifest (section names and counts); the operator never sees its content and
 * the server re-verifies every digest before writing anything.
 */
export function RestoreTenant({ onRestored }: { onRestored: () => void }) {
  const qc = useQueryClient();
  const [archive, setArchive] = useState<Archive | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', slug: '', plan: '', adminEmail: '', adminPassword: '' });
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));

  async function pick(e: ChangeEvent<HTMLInputElement>) {
    setArchive(null);
    setFileError(null);
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text()) as Archive;
      if (parsed.format !== 'appraisal-tenant-export' || !Array.isArray(parsed.manifest)) throw new Error('not an export');
      setArchive(parsed);
      set({
        name: parsed.tenant?.name ? `${parsed.tenant.name} (restored)` : '',
        slug: parsed.tenant?.slug ? `${parsed.tenant.slug}-restored` : '',
        plan: parsed.tenant?.plan ?? '',
      });
    } catch {
      setFileError('This file is not an organisation export.');
    }
  }

  const restore = useMutation({
    mutationFn: () =>
      platformApi.post<RestoreResponse>('/api/platform/tenants/import', {
        name: form.name,
        slug: form.slug,
        ...(form.plan ? { plan: form.plan } : {}),
        admin: { email: form.adminEmail, password: form.adminPassword },
        archive,
      } as never),
    onSuccess: (r) => {
      toast.success(`${r.tenant.name} restored: ${r.report.rows} records in ${r.durationMs} ms`);
      void qc.invalidateQueries({ queryKey: qk.platform.tenants });
      onRestored();
    },
  });
  const errors = restore.error instanceof ApiError ? restore.error.fieldErrors : {};
  const submit = (e: FormEvent) => {
    e.preventDefault();
    restore.mutate();
  };
  const total = archive?.manifest.reduce((n, m) => n + m.rows, 0) ?? 0;

  return (
    <Page>
      <PageHeader
        eyebrow="Portability"
        title="Restore from export"
        subtitle="A new tenant from an organisation’s export: new identifiers, verified digests, one transaction (ADR-016)."
      />
      <form onSubmit={submit} className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <div className="space-y-6">
          <Card title="Export file" icon={<FileJson className="size-4" />}>
            <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-line px-6 py-8 text-center transition-colors hover:border-brand hover:bg-brand/5">
              <ArchiveRestore className="size-6 text-muted" />
              <span className="text-sm font-medium text-fg">{archive ? 'Choose another file' : 'Choose an export (.json)'}</span>
              <span className="text-xs text-muted">Read locally to show its manifest; the server verifies every checksum again.</span>
              <input type="file" accept="application/json,.json" className="sr-only" onChange={(e) => void pick(e)} />
            </label>
            {fileError && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{fileError}</p>}
          </Card>

          <Card title="New tenant">
            <div className="grid gap-4 md:grid-cols-3">
              <Field label="Name" error={errors.name}>
                {(id, inv) => <Input id={id} aria-invalid={inv} required value={form.name} onChange={(e) => set({ name: e.target.value })} />}
              </Field>
              <Field label="Sub-domain" error={errors.slug} hint={form.slug ? `${form.slug}.localhost` : 'lowercase, digits, hyphens'}>
                {(id, inv) => (
                  <Input id={id} aria-invalid={inv} required pattern="[a-z0-9-]{3,40}" value={form.slug} onChange={(e) => set({ slug: e.target.value.toLowerCase() })} />
                )}
              </Field>
              <Field label="Plan" hint="Defaults to the plan in the export">
                {(id) => (
                  <Select id={id} value={form.plan} onChange={(e) => set({ plan: e.target.value })}>
                    <option value="">From export</option>
                    {PLAN_CODES.map((p) => (
                      <option key={p}>{p}</option>
                    ))}
                  </Select>
                )}
              </Field>
            </div>
          </Card>

          <Card title="Administrator who signs in first" description="An active Tenant admin of the exported organisation. Everyone else gets a password from them later.">
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Admin e-mail (from the export)" error={errors['admin.email']}>
                {(id, inv) => <Input id={id} aria-invalid={inv} type="email" required value={form.adminEmail} onChange={(e) => set({ adminEmail: e.target.value })} />}
              </Field>
              <Field label="New password" error={errors['admin.password']}>
                {(id, inv) => (
                  <Input
                    id={id}
                    aria-invalid={inv}
                    type="password"
                    required
                    minLength={10}
                    autoComplete="new-password"
                    value={form.adminPassword}
                    onChange={(e) => set({ adminPassword: e.target.value })}
                  />
                )}
              </Field>
            </div>
          </Card>
          {restore.error && <ErrorBox error={restore.error} />}
          <Button type="submit" size="lg" icon={<ArchiveRestore className="size-4" />} busy={restore.isPending} disabled={!archive}>
            Restore organisation
          </Button>
        </div>

        <div className="space-y-4 xl:sticky xl:top-20 xl:self-start">
          <AnimatePresence mode="wait">
            {archive ? (
              <motion.div key="manifest" variants={fadeUp} initial="hidden" animate="show" exit={{ opacity: 0 }}>
                <Card
                  title="Manifest"
                  description={`${archive.tenant?.slug ?? 'unknown'} · exported ${archive.exportedAt?.slice(0, 10) ?? '—'}`}
                  icon={<ShieldCheck className="size-4" />}
                  actions={<Badge>{total} records</Badge>}
                >
                  <ul className="space-y-1.5 text-xs">
                    {archive.manifest.map((m) => (
                      <li key={m.section} className="flex items-center justify-between gap-3 rounded-lg bg-surface-2 px-3 py-1.5" dir="ltr">
                        <span className="truncate font-medium text-fg">{m.section}</span>
                        <span className="flex shrink-0 items-center gap-2 tabular text-muted">
                          {m.rows}
                          <code className="text-[10px] opacity-70" title={m.sha256}>
                            {m.sha256.slice(0, 8)}
                          </code>
                        </span>
                      </li>
                    ))}
                  </ul>
                </Card>
              </motion.div>
            ) : (
              <motion.p key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="rounded-2xl border border-dashed border-line p-6 text-sm text-muted">
                The manifest of the chosen export appears here: sections, record counts and checksums. Content is never shown.
              </motion.p>
            )}
          </AnimatePresence>
        </div>
      </form>
    </Page>
  );
}
