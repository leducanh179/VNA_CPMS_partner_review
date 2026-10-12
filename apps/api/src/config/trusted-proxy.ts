/** The production API listens on loopback; only its local reverse proxy may supply client IPs. */
export function configureTrustedProxy(app: { set(name: string, value: string | false): unknown }, nodeEnv: string): void {
  app.set('trust proxy', nodeEnv === 'production' ? 'loopback' : false);
}
