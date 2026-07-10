module.exports = function handler(request, response) {
  const config = {
    url: process.env.SUPABASE_URL || "",
    anonKey: process.env.SUPABASE_ANON_KEY || "",
  };
  const configured = Boolean(config.url && config.anonKey);

  response.setHeader("Cache-Control", "no-store, max-age=0");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.status(200).json({
    configured,
    roomApiConfigured: Boolean(configured && process.env.SUPABASE_SERVICE_ROLE_KEY),
    config,
  });
};
