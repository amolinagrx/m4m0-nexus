export interface APIToken {
  id: string;
  name: string;
  token_hash: string;
  user_id: string;
  scopes: string[];
  expires_at?: Date;
  last_used_at?: Date;
}
