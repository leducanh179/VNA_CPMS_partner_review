/** Local source inspection only. No database writes, profile provisioning or activation. */
import { readFile, writeFile, realpath, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { DirectoryImportApplicationService } from '../apps/api/src/modules/identity/application/directory-import.application-service';
import { ExcelJsSpreadsheetAdapter } from '../apps/api/src/modules/campaign/infrastructure/exceljs-spreadsheet.adapter';

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 1) throw new Error('Usage: pnpm exec tsx scripts/inspect-personnel-directory.ts <source.xlsx>');
  const repo = path.resolve(__dirname, '..');
  const source = await realpath(path.resolve(args[0]!));
  const sourceRoot = await realpath(path.join(repo, 'local-source'));
  const relative = path.relative(sourceRoot, source);
  if (relative.startsWith('..') || path.isAbsolute(relative) || path.extname(source).toLowerCase() !== '.xlsx') throw new Error('Source must be an XLSX inside local-source.');
  const outputRoot = path.join(repo, 'private-local', 'access-demo');
  const output = path.join(outputRoot, 'source-inspection.json');
  execFileSync('git', ['check-ignore', '--quiet', '--', output], { cwd: repo });
  if (execFileSync('git', ['ls-files', '--', 'private-local', 'local-source'], { cwd: repo, encoding: 'utf8' }).trim()) throw new Error('Source/private paths must not contain tracked files.');
  await mkdir(outputRoot, { recursive: true });
  const resolvedOutputRoot = await realpath(outputRoot);
  if (resolvedOutputRoot.toLowerCase() !== outputRoot.toLowerCase()) throw new Error('Private output must not be redirected by a junction.');
  const service = new DirectoryImportApplicationService(new ExcelJsSpreadsheetAdapter());
  const inspected = await service.inspect({ fileName: path.basename(source), content: await readFile(source) });
  const report = { mode: 'SOURCE_INSPECTION_ONLY', databaseCompared: false, applied: false, ...inspected };
  await writeFile(output, JSON.stringify(report, null, 2), { encoding: 'utf8', mode: 0o600 });
  console.log(JSON.stringify({ mode: report.mode, databaseCompared: false, applied: false, people: inspected.parsed.people.length,
    pending: inspected.parsed.pending.length, invalid: inspected.parsed.invalid.length, warnings: inspected.parsed.warnings.map((warning) => warning.code), reportPath: output }));
}
void main().catch(() => { console.error('Personnel inspection failed. Check source path, headers, size, and private output protection. No data was applied.'); process.exitCode = 1; });
