// Disable optional telemetry before the CLI starts. Avoid Windows user-config
// atomic rename failures; this does not alter any user environment file.
process.env.NEXT_TELEMETRY_DISABLED = '1';
