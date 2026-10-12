import { CAMPAIGN_DRIVE_FILE_STATUSES, CAMPAIGN_DRIVE_FOLDER_KEYS } from '@cpms/domain';
import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsOptional, IsString, Length, Matches } from 'class-validator';

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
}
