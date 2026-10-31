/**
 * Facts only the host knows (disk, backup settings, proxy trust). The server implements it;
 * the browser demo and tests may leave it out, and the System page then shows "Not reported".
 */
export interface SystemHost {
  describe(): Promise<SystemHostInfo>;
}

export interface DiskUsage {
  /** What lives there, e.g. "Data (files, key)", "Backups". */
  label: string;
  path: string;
  freeBytes: number;
  totalBytes: number;
}

export interface SystemHostInfo {
  publicUrl: string;
  /** True when PUBLIC_URL is https: cookies are `Secure`. */
  secureCookies: boolean;
  /** TRUSTED_PROXIES entries after alias expansion. */
  trustedProxies: readonly string[];
  database: { driver: "postgres" | "pglite" };
  backups: {
    directory: string;
    /** BACKUP_PASSPHRASE is set. */
    encrypted: boolean;
    /** e.g. "02:00 Asia/Singapore", or null when scheduled backups are off. */
    schedule: string | null;
    keep: number;
    beforeMigrate: boolean;
  };
  disk: readonly DiskUsage[];
  migrations: { bundled: number; latestBundledTag: string | null };
}
