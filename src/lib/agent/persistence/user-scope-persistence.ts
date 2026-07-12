export interface UserScopePersistence {
  load(userId: string): Promise<string[]>;
}
