// Support custom port via environment variable
export const DAEMON_PORT = parseInt(process.env.MCPS_PORT || '4100');
export const DAEMON_BASE_URL = `http://localhost:${DAEMON_PORT}`;
