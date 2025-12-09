/**
 * Re-export shared types for frontend use
 * This file acts as the frontend entry point to shared types
 */

export type {
  Email,
  Attachment,
  ApiEmailResponse,
  ArchivedEmail
} from '../../shared/types/email';

export type {
  Bucket,
  ApiBucketResponse
} from '../../shared/types/bucket';

export type {
  Rule,
  ApiRuleResponse
} from '../../shared/types/rule';

export type {
  ApiResponse,
  ApiMeta,
  ApiError
} from '../../shared/types/api';
