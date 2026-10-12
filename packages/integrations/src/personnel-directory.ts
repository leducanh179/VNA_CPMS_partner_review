/** Provider adapters supply stable external IDs. Scheduling/credentials belong to the host integration. */
export interface PersonnelDirectorySnapshot {
  provider: string; batchId: string; capturedAt: string;
  people: Array<{ externalId: string; employeeCode: string; fullName: string; email: string | null;
    organizationName: string; departmentName: string | null; jobTitle: string | null; phoneText: string | null;
    isActive: boolean; sourceUpdatedAt: string | null }>;
}
export interface PersonnelDirectoryPort { readSnapshot(cursor?: string): Promise<PersonnelDirectorySnapshot>; }
export const PERSONNEL_DIRECTORY_PORT = Symbol('PERSONNEL_DIRECTORY_PORT');
