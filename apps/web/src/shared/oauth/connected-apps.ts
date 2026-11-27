export type ConnectedApp = {
  clientId: string;
  /** The client's own claim; shown as unverified. */
  name: string | null;
  /** Host of an https client_id. */
  host: string | null;
  scopes: string[];
  grantedAt: string;
};
