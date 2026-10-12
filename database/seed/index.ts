import {
  CampaignLifecycleState,
  CampaignNormalizationStatus,
  OrganizationUnitCategory,
  PrismaClient,
} from '@prisma/client';
import {
  CAMPAIGN_LEVEL_ROWS,
  CAMPAIGN_OBJECTIVE_ROWS,
  CONTENT_PILLAR_ROWS,
  FOREIGN_BRANCH_ROWS,
  MARKET_REGION_ROWS,
  MARKET_ROWS,
  PERSONNEL_DIRECTORY_ROWS,
  QUICK_ORGANIZATION_UNIT_ROWS,
} from './campaign-v2-catalog.data';
import { MATERIAL_INPUT_ROWS, MATERIAL_PORTAL_REFERENCE_ROWS } from './material-portal-reference.data';

const prisma = new PrismaClient();

const DEMO_ACTOR_ID = '00000000-0000-4000-8000-000000000001';
const BOOTSTRAP_AUDIT_ID = '00000000-0000-4000-8000-000000000002';

const roles = [
  ['VIEWER', 'Viewer', 'Reads material records inside assigned scopes.'],
  ['REQUESTER', 'Requester', 'Submits requests and reads approved material records.'],
  ['CAMPAIGN_MANAGER', 'Campaign Manager', 'Creates and maintains campaign material records.'],
  ['CONTRACT_MANAGER', 'Contract Manager', 'Maintains contracts and the material lifecycle.'],
  ['CAMPAIGN_REQUESTER', 'Campaign Requester', 'Creates and follows requests for communication campaigns.'],
  ['COMM_CAMPAIGN_MANAGER', 'COMM Campaign Manager', 'Coordinates campaign objectives, plans, participants, and outcomes.'],
  ['COMM_CONTRACT_MANAGER', 'COMM Contract Manager', 'Manages contracts, channels, and advertising slot supply.'],
  ['SLOT_OPERATOR', 'Slot Operator', 'Books and operates assigned advertising slots.'],
  ['VENDOR', 'Vendor', 'Confirms bookings and supplies delivery and acceptance evidence.'],
  ['LEADER', 'Leader', 'Reviews, directs, assigns, and approves within delegated authority.'],
  ['ADMIN', 'Admin', 'Administers accounts, permissions, catalogs, rules, and configuration.'],
  ['GUEST', 'Guest', 'Reads explicitly shared public information only.'],
] as const;

function referenceKey(type: string, row: Record<string, string>, index: number) {
  const candidates = [
    row.email, row.field_name, row['Quyền / phạm vi'], row.permission_code,
    row.contract_id, row.key, row.template_code, row.campaign_code,
    row.timestamp && `${row.timestamp}:${row.material_id ?? ''}:${row.action ?? ''}`,
    row.market_code, row.VALUE,
  ];
  const value = candidates.find((candidate) => candidate?.trim())?.trim() || type;
  return `${String(index + 1).padStart(4, '0')}:${value}`;
}

const sampleCampaigns = [
  {
    id: '10000000-0000-4000-8000-000000000001',
    code: 'CPG-202608-DEMO',
    name: 'Chiến dịch demo CPMS portable',
    requestingUnit: 'Ban Truyền thông',
    lifecycleState: CampaignLifecycleState.DRAFT,
    startDate: new Date('2026-09-01T00:00:00.000Z'),
    endDate: new Date('2026-09-30T00:00:00.000Z'),
    fieldValues: {
      campaign_code: 'CPG-202608-DEMO', campaign_name: 'Chiến dịch demo CPMS portable', requesting_unit: 'Ban Truyền thông',
      campaign_lifecycle_state: 'DRAFT', campaign_level_code: 'CLV_01', campaign_comm_start_date: '2026-09-01', campaign_comm_end_date: '2026-09-30',
    },
    levelCode: 'CLV_01',
  },
  {
    id: '10000000-0000-4000-8000-000000000002',
    code: 'CPG-202609-ROUTE',
    name: 'Truyền thông khai trương đường bay mẫu',
    requestingUnit: 'Ban TTBSP',
    lifecycleState: CampaignLifecycleState.PLANNING,
    startDate: new Date('2026-09-15T00:00:00.000Z'),
    endDate: new Date('2026-11-15T00:00:00.000Z'),
    fieldValues: {
      campaign_code: 'CPG-202609-ROUTE', campaign_name: 'Truyền thông khai trương đường bay mẫu', requesting_unit: 'Ban TTBSP',
      campaign_lifecycle_state: 'PLANNING', campaign_level_code: 'CLV_01', campaign_comm_start_date: '2026-09-15', campaign_comm_end_date: '2026-11-15',
    },
    levelCode: 'CLV_01',
  },
  {
    id: '10000000-0000-4000-8000-000000000003',
    code: 'CPG-202610-PROMO',
    name: 'Ưu đãi mùa thu mẫu',
    requestingUnit: 'Chi nhánh Việt Nam',
    lifecycleState: CampaignLifecycleState.READY_TO_LAUNCH,
    startDate: new Date('2026-10-01T00:00:00.000Z'),
    endDate: new Date('2026-10-31T00:00:00.000Z'),
    fieldValues: {
      campaign_code: 'CPG-202610-PROMO', campaign_name: 'Ưu đãi mùa thu mẫu', requesting_unit: 'Chi nhánh Việt Nam',
      campaign_lifecycle_state: 'READY_TO_LAUNCH', campaign_level_code: 'CLV_01', campaign_comm_start_date: '2026-10-01', campaign_comm_end_date: '2026-10-31',
    },
    levelCode: 'CLV_01',
  },
] as const;

async function main() {
  for (const [code, displayName, description] of roles) {
    await prisma.role.upsert({
      where: { code },
      update: { displayName, description },
      create: { code, displayName, description },
    });
  }

  await prisma.actor.upsert({
    where: { id: DEMO_ACTOR_ID },
    update: { key: 'demo-superuser', displayName: 'Demo Superuser', isActive: true },
    create: {
      id: DEMO_ACTOR_ID,
      key: 'demo-superuser',
      displayName: 'Demo Superuser',
      isActive: true,
    },
  });

  await prisma.actorRole.upsert({
    where: { actorId_roleCode: { actorId: DEMO_ACTOR_ID, roleCode: 'ADMIN' } },
    update: {},
    create: { actorId: DEMO_ACTOR_ID, roleCode: 'ADMIN' },
  });

  // New demo databases start with the Booking gate on; reseeding preserves every configured policy version.
  if (!await prisma.bookingWorkflowPolicy.count()) {
    await prisma.bookingWorkflowPolicy.create({data:{version:1,required:true,actorId:DEMO_ACTOR_ID,reason:'Initial Booking approval policy; later changes use the authenticated administration workflow.'}});
  }

  for (const row of CAMPAIGN_LEVEL_ROWS) {
    await prisma.campaignLevel.upsert({
      where: { code: row.code },
      update: { ...row, isActive: true },
      create: { ...row, isActive: true },
    });
  }

  for (const row of CAMPAIGN_OBJECTIVE_ROWS) {
    await prisma.campaignObjective.upsert({
      where: { code: row.code },
      update: { ...row, isActive: true },
      create: { ...row, isActive: true },
    });
  }

  for (const row of MARKET_REGION_ROWS) {
    await prisma.marketRegion.upsert({
      where: { code: row.code },
      update: { ...row, isActive: true },
      create: { ...row, isActive: true },
    });
  }

  for (const row of MARKET_ROWS) {
    await prisma.market.upsert({
      where: { code: row.code },
      update: { ...row, isActive: true },
      create: { ...row, isActive: true },
    });
  }

  for (const row of QUICK_ORGANIZATION_UNIT_ROWS) {
    await prisma.organizationUnit.upsert({
      where: { code: row.code },
      update: {
        displayName: row.displayName,
        category: OrganizationUnitCategory.QUICK_SELECT,
        sourceProvider: 'DEMO',
        displayOrder: row.displayOrder,
        isActive: true,
      },
      create: {
        ...row,
        category: OrganizationUnitCategory.QUICK_SELECT,
        sourceProvider: 'DEMO',
        isActive: true,
      },
    });
  }

  for (const row of FOREIGN_BRANCH_ROWS) {
    await prisma.organizationUnit.upsert({
      where: { code: row.code },
      update: {
        ...row,
        category: OrganizationUnitCategory.FOREIGN_BRANCH,
        sourceProvider: 'SKYOFFICE_EXTRACT',
        isActive: true,
      },
      create: {
        ...row,
        category: OrganizationUnitCategory.FOREIGN_BRANCH,
        sourceProvider: 'SKYOFFICE_EXTRACT',
        isActive: true,
      },
    });
  }

  const demoPersonnelCodes = PERSONNEL_DIRECTORY_ROWS.map((row) => row.employeeCode);
  const existingDemoPersonnel = await prisma.personnelDirectoryEntry.findMany({
    where: { sourceProvider: { in: ['DEMO', 'DEMO_EXCEL'] } },
    orderBy: { employeeCode: 'asc' },
    select: { employeeCode: true },
  });
  const existingDemoCodeSet = new Set(existingDemoPersonnel.map((row) => row.employeeCode));
  const legacyDemoPersonnel = existingDemoPersonnel.filter((row) => !demoPersonnelCodes.includes(row.employeeCode as typeof demoPersonnelCodes[number]));
  const missingDemoPersonnel = PERSONNEL_DIRECTORY_ROWS.filter((row) => !existingDemoCodeSet.has(row.employeeCode));
  if (legacyDemoPersonnel.length !== missingDemoPersonnel.length) {
    throw new Error('Demo personnel cannot be anonymized safely: the legacy and missing demo row counts do not match.');
  }
  if (legacyDemoPersonnel.length > 0) {
    await prisma.$transaction(legacyDemoPersonnel.map((legacyRow, index) => {
      const replacement = missingDemoPersonnel[index];
      if (!replacement) throw new Error('Demo personnel replacement mapping is incomplete.');
      return prisma.personnelDirectoryEntry.update({
        where: { employeeCode: legacyRow.employeeCode },
        data: { ...replacement, sourceProvider: 'DEMO', isActive: true },
      });
    }));
  }

  for (const row of PERSONNEL_DIRECTORY_ROWS) {
    await prisma.personnelDirectoryEntry.upsert({
      where: { employeeCode: row.employeeCode },
      update: { ...row, sourceProvider: 'DEMO', isActive: true },
      create: { ...row, sourceProvider: 'DEMO', isActive: true },
    });
  }
  const demoPersonnelCount = await prisma.personnelDirectoryEntry.count({
    where: { sourceProvider: { in: ['DEMO', 'DEMO_EXCEL'] } },
  });
  if (demoPersonnelCount !== PERSONNEL_DIRECTORY_ROWS.length) {
    throw new Error(`Demo personnel seed expected ${PERSONNEL_DIRECTORY_ROWS.length} rows but found ${demoPersonnelCount}.`);
  }

  for (const row of CONTENT_PILLAR_ROWS) {
    // Operational dictionaries are maintained through their Application Service after migration.
    // Re-running bootstrap must never overwrite names, status or relationships edited by users.
    await prisma.contentPillar.upsert({
      where: { code: row.code },
      update: {},
      create: {
        ...row,
        effectiveStart: new Date('2026-01-01T00:00:00.000Z'),
        effectiveEnd: new Date('2026-12-31T00:00:00.000Z'),
        isActive: true,
      },
    });
    if (!await prisma.qcttCatalogReservedCode.findUnique({ where: { code: row.code } })) {
      await prisma.qcttCatalogEntry.upsert({
        where: { code: row.code }, update: {},
        create: { code: row.code, kind: row.level === 1 ? 'PILLAR' : 'TOPIC', name: row.label,
          year: row.year, parentCode: row.parentCode, effectiveFrom: new Date('2026-01-01'),
          effectiveTo: new Date('2026-12-31'), source: { origin: 'CONTENT_PILLAR' } },
      });
    }
  }

  for (const campaign of sampleCampaigns) {
    await prisma.campaign.upsert({
      where: { code: campaign.code },
      update: {},
      create: {
        ...campaign,
        dataSchemaVersion: 2,
        normalizationStatus: CampaignNormalizationStatus.CURRENT,
        createdByActorId: DEMO_ACTOR_ID,
      },
    });
  }

  for (const row of MATERIAL_INPUT_ROWS) {
    const materialId = row.material_id;
    if (!materialId) continue;
    const recordVersion = Math.max(1, Number.parseInt(row.record_version || '1', 10) || 1);
    const isDeleted = row.is_deleted?.toUpperCase() === 'TRUE';
    const createdBy = row.created_by || row.updated_by || 'demo-superuser';
    const updatedBy = row.updated_by || createdBy;
    await prisma.materialRecord.upsert({
      where: { materialId },
      update: { data: row, recordVersion, isDeleted, createdBy, updatedBy },
      create: { materialId, data: row, recordVersion, isDeleted, createdBy, updatedBy },
    });
  }

  for (const [type, rows] of Object.entries(MATERIAL_PORTAL_REFERENCE_ROWS)) {
    await prisma.materialPortalReference.deleteMany({ where: { type } });
    for (const [index, row] of rows.entries()) {
      const key = referenceKey(type, row, index);
      await prisma.materialPortalReference.create({ data: { type, key, data: row } });
    }
  }

  await prisma.auditEvent.upsert({
    where: { id: BOOTSTRAP_AUDIT_ID },
    update: {
      actorId: DEMO_ACTOR_ID,
      payload: { seedVersion: 'TASK-BOOT-001', role: 'ADMIN' },
    },
    create: {
      id: BOOTSTRAP_AUDIT_ID,
      actorId: DEMO_ACTOR_ID,
      action: 'system.demo_seeded',
      entityType: 'system',
      entityId: null,
      payload: { seedVersion: 'TASK-BOOT-001', role: 'ADMIN' },
    },
  });
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error: unknown) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
