export interface WebContent {
  title: string | null;
  siteName: string | null;
  content: string | null;
}

export interface MessageMetadata {
  isGroupMember: boolean;
  priority: number;
  processedAt?: Date;
  error?: string;
}

export type ClassificationMap = Record<string, boolean>;