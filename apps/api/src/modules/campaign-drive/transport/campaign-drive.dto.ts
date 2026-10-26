import { CAMPAIGN_DRIVE_FILE_STATUSES, CAMPAIGN_DRIVE_FOLDER_KEYS } from '@cpms/domain';
import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Min } from 'class-validator';

export class CampaignDriveFolderQueryDto {
  @ApiProperty({ enum: CAMPAIGN_DRIVE_FOLDER_KEYS })
  @IsIn(CAMPAIGN_DRIVE_FOLDER_KEYS)
  folderKey!: (typeof CAMPAIGN_DRIVE_FOLDER_KEYS)[number];

  @IsOptional()
  @IsString()
  @Length(1, 1000)
  @Matches(/^[A-Za-z0-9._~-]+$/)
  pageToken?: string;
}

export class CampaignDriveFileListQueryDto {
  @ApiProperty({ enum: CAMPAIGN_DRIVE_FOLDER_KEYS })
  @IsIn(CAMPAIGN_DRIVE_FOLDER_KEYS)
  folderKind!: (typeof CAMPAIGN_DRIVE_FOLDER_KEYS)[number];

  @ApiProperty({ enum: CAMPAIGN_DRIVE_FILE_STATUSES })
  @IsIn(CAMPAIGN_DRIVE_FILE_STATUSES)
  status!: (typeof CAMPAIGN_DRIVE_FILE_STATUSES)[number];

  @IsOptional()
  @IsString()
  @Length(1, 1000)
  @Matches(/^[A-Za-z0-9._~-]+$/)
  pageToken?: string;
}

export class RenameCampaignDriveFileDto {
  @ApiProperty({ minLength: 1, maxLength: 255 })
  @IsString()
  @Length(1, 255)
  name!: string;
}

export class ExistingCampaignDriveFolderDto {
  @ApiProperty({ example: 'https://drive.google.com/drive/folders/EXAMPLE_FOLDER_ID' })
  @IsString()
  @Length(20, 500)
  folderUrl!: string;
}

export class AdoptCampaignDriveFolderDto extends ExistingCampaignDriveFolderDto {
  @ApiProperty()
  @IsString()
  @Length(1, 255)
  expectedCurrentName!: string;

  @ApiProperty({ description: 'Confirm that CPMS may rename this folder to the current Campaign code and name' })
  @IsBoolean()
  confirmRename!: boolean;

  @ApiProperty({ required: false, description: 'Previously linked empty CPMS folder expected by the user' })
  @IsOptional()
  @IsString()
  @Length(10, 150)
  @Matches(/^[A-Za-z0-9_-]+$/)
  expectedPreviousFolderId?: string;
}

export class RequestCampaignDriveRelinkDto extends AdoptCampaignDriveFolderDto {
  @ApiProperty({ minLength: 1, maxLength: 2000 })
  @IsString()
  @Length(1, 2000)
  reason!: string;

  @ApiProperty({ description: 'The linked folder ID shown in the preview' })
  @IsString()
  @Length(10, 200)
  @Matches(/^[A-Za-z0-9_-]+$/)
  declare expectedPreviousFolderId: string;
}

export class DecideCampaignDriveRelinkDto {
  @IsBoolean()
  approve!: boolean;

  @IsString()
  @Length(0, 2000)
  reason!: string;

  @IsInt()
  @Min(1)
  expectedVersion!: number;
}

export class CampaignDriveBrowseDto {
  @IsOptional()
  @IsString()
  @Length(10, 200)
  @Matches(/^[A-Za-z0-9_-]+$/)
  folderId?: string;

  @IsIn(CAMPAIGN_DRIVE_FILE_STATUSES)
  status!: (typeof CAMPAIGN_DRIVE_FILE_STATUSES)[number];

  @IsOptional()
  @IsString()
  @Length(1, 1000)
  @Matches(/^[A-Za-z0-9._~-]+$/)
  pageToken?: string;

  @IsOptional()
  @IsIn(['NAME', 'UPDATED', 'SIZE'])
  sortBy?: 'NAME' | 'UPDATED' | 'SIZE';

  @IsOptional()
  @IsIn(['ASC', 'DESC'])
  direction?: 'ASC' | 'DESC';
}

export class CampaignDriveTargetFolderDto {
  @IsString()
  @Length(10, 200)
  @Matches(/^[A-Za-z0-9_-]+$/)
  folderId!: string;
}

export class CampaignDriveUploadDto extends CampaignDriveTargetFolderDto {
  @IsOptional()
  @IsUUID('4')
  uploadId?: string;
}

export class CampaignDriveDownloadDto extends CampaignDriveTargetFolderDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(25)
  @IsString({ each: true })
  @Matches(/^[A-Za-z0-9_-]{10,200}$/, { each: true })
  itemIds!: string[];
}

export class CampaignDriveCreateFolderDto extends CampaignDriveTargetFolderDto {
  @IsString()
  @Length(1, 255)
  name!: string;
}

export class CampaignDriveCreatePermissionDto {
  @IsIn(['user', 'anyone'])
  type!: 'user' | 'anyone';

  @IsIn(['reader', 'commenter', 'writer'])
  role!: 'reader' | 'commenter' | 'writer';

  @IsOptional()
  @IsString()
  @Length(3, 254)
  emailAddress?: string;
}

export class CampaignDriveUpdatePermissionDto {
  @IsIn(['reader', 'commenter', 'writer'])
  role!: 'reader' | 'commenter' | 'writer';
}

export class CampaignDriveGeneralAccessDto {
  @IsIn(['RESTRICTED', 'ANYONE'])
  access!: 'RESTRICTED' | 'ANYONE';

  @IsOptional()
  @IsIn(['reader', 'commenter', 'writer'])
  role?: 'reader' | 'commenter' | 'writer';

  @IsBoolean()
  confirmLimitInheritedAccess!: boolean;
}
