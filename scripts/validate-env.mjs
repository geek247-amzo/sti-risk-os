const required = ["DATABASE_URL"];

const productionRequired = [
  "SESSION_SECRET",
  "WEBHOOK_SECRET",
  "POSTGRES_PASSWORD",
  "INITIAL_ADMIN_PASSWORD",
  "N8N_AGENT_TOKEN",
];

const placeholderValues = new Set([
  "change-this-session-secret",
  "change-this-webhook-secret",
  "change-me-n8n-agent-token",
  "sti_dev_password",
  "G33k@dmin247",
  "password",
  "changeme",
]);

const isProduction = process.env.NODE_ENV === "production";
const missing = [];
const unsafe = [];

for (const key of required) {
  if (!process.env[key]) missing.push(key);
}

if (isProduction) {
  for (const key of productionRequired) {
    const value = process.env[key];
    if (!value) {
      missing.push(key);
    } else if (placeholderValues.has(value)) {
      unsafe.push(key);
    }
  }
}

if (missing.length || unsafe.length) {
  const details = [
    missing.length ? `missing: ${missing.join(", ")}` : "",
    unsafe.length ? `unsafe placeholders: ${unsafe.join(", ")}` : "",
  ]
    .filter(Boolean)
    .join("; ");
  throw new Error(`Environment validation failed (${details})`);
}

console.log(
  isProduction
    ? "Environment validation passed for production startup"
    : "Environment validation passed",
);
