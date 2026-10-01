export class RealmNotFoundError extends Error {
  constructor(realm: string) {
    super(`Realm '${realm}' not found`);
  }
}
