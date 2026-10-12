/** Prepare a private, reviewed directory payload for the existing authenticated sync API. Never commits source data. */
import { createHash } from 'node:crypto';
import { readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

async function main() {
  const root = path.resolve(__dirname, '..');
  const source = path.join(root, 'private-local', 'access-demo', 'source-inspection.json');
  const output = path.join(root, 'private-local', 'access-demo', 'pilot-directory-snapshot.json');
  const excluded = new Set(process.argv.slice(2).map((code) => code.trim()).filter(Boolean));
  const report = JSON.parse(await readFile(source, 'utf8')) as {
    sourceHash: string;
    parsed: { people: Array<{ employeeCode: string; fullName: string; email: string; organizationName: string; departmentName: string | null; jobTitle: string | null; sourceReference: string }> };
  };
  if (!report.sourceHash || !Array.isArray(report.parsed?.people)) throw new Error('Source inspection report is invalid.');
  const people = report.parsed.people.filter((person) => !excluded.has(person.employeeCode)).map((person) => ({
    externalId: person.employeeCode,
    employeeCode: person.employeeCode,
    fullName: person.fullName,
    email: person.email || null,
    organizationName: person.organizationName,
    departmentName: person.departmentName || null,
    jobTitle: person.jobTitle || null,
    phoneText: null,
    isActive: true,
    sourceUpdatedAt: null,
  }));
  if (people.length < 1 || new Set(people.map((person) => person.employeeCode)).size !== people.length) throw new Error('Directory payload is empty or has duplicate employee codes.');
  const digest = createHash('sha256').update(JSON.stringify(people)).digest('hex');
  const payload = { provider: 'CPMS_PERSONNEL_WORKBOOK', batchId: digest.slice(0, 32), capturedAt: new Date().toISOString(), people };
  await stat(output).then(() => { throw new Error('Private payload already exists; inspect it rather than overwrite a submitted batch.'); }, () => undefined);
  await writeFile(output, JSON.stringify(payload), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  console.log(JSON.stringify({ output, count: people.length, excluded: excluded.size, sourceDigestMatches: Boolean(report.sourceHash) }));
}

void main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : 'Could not prepare private directory snapshot.'); process.exitCode = 1; });
