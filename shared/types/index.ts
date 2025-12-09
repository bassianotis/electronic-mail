/**
 * Shared types for the Electronic Mail application
 * Used by both frontend and backend
 */

// Core domain types
export type { Email, Attachment, ApiEmailResponse, ArchivedEmail } from './email';
export type { Bucket, ApiBucketResponse } from './bucket';
export type { Rule, ApiRuleResponse } from './rule';

// API types
export type { ApiResponse, ApiMeta, ApiError } from './api';
