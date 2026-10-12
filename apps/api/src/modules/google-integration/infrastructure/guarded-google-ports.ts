import type { CloudDrivePort, CloudSpreadsheetPort, UserOAuthPort } from '@cpms/integrations';
import type { ProviderOperationAccessService } from '../application/provider-operation-access.service';

/** Guard the actual adapter entrypoints as well as the Application Service. Read contexts cannot write. */
export function guardedGooglePorts(adapter: CloudDrivePort & CloudSpreadsheetPort & UserOAuthPort, access: ProviderOperationAccessService): CloudDrivePort & CloudSpreadsheetPort & UserOAuthPort {
  const driveReads = ['campaign.create','campaign.delete','campaign.restore','campaign.approve','campaign.drive.read','campaign.drive.ensure','campaign.drive.upload','campaign.drive.rename','campaign.drive.trash','campaign.drive.restore'] as const;
  const sheetReads = ['campaign.sheets.read','campaign.sheets.write'] as const;
  return {
    authorizationUrl: (...args) => { access.assert(['google.connect', 'system.manage']); return adapter.authorizationUrl(...args); },
    exchangeCode: (...args) => { access.assert(['google.connect', 'system.manage']); return adapter.exchangeCode(...args); },
    identity: (...args) => { access.assert(['google.connect', 'system.manage']); return adapter.identity(...args); },
    refresh: (...args) => { access.assert(); return adapter.refresh(...args); },
    revoke: (...args) => { access.assert(['google.revoke', 'system.manage']); return adapter.revoke(...args); },
    metadata: (...args) => { access.assert(sheetReads); return adapter.metadata(...args); },
    readTab: (...args) => { access.assert(sheetReads); return adapter.readTab(...args); },
    createTab: (...args) => { access.assert(['campaign.sheets.write']); return adapter.createTab(...args); },
    getItem: (...args) => { access.assert([...driveReads, 'campaign.purge']); return adapter.getItem(...args); },
    findFolders: (...args) => { access.assert(driveReads); return adapter.findFolders(...args); },
    listFiles: (...args) => { access.assert(driveReads); return adapter.listFiles(...args); },
    listPermissions: (...args) => { access.assert(driveReads); return adapter.listPermissions(...args); },
    createFolder: (...args) => { access.assert(['campaign.create','campaign.restore','campaign.approve','campaign.drive.ensure','campaign.drive.restore']); return adapter.createFolder(...args); },
    createLinkWriterPermission: (...args) => { access.assert(['campaign.drive.ensure']); return adapter.createLinkWriterPermission(...args); },
    renameItem: (...args) => { access.assert(['campaign.drive.rename']); return adapter.renameItem(...args); },
    setTrashed: (input) => { access.assert(input.trashed ? ['campaign.delete','campaign.approve','campaign.drive.trash'] : ['campaign.restore','campaign.approve','campaign.drive.ensure','campaign.drive.restore']); return adapter.setTrashed(input); },
    moveItem: (...args) => { access.assert(['campaign.restore','campaign.approve','campaign.drive.restore']); return adapter.moveItem(...args); },
    upload: (...args) => { access.assert(['campaign.drive.upload']); return adapter.upload(...args); },
  };
}
