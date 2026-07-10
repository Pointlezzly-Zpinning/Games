module.exports = function handler(request, response) {
  const config = {
    url: process.env.SUPABASE_URL || "",
    anonKey: process.env.SUPABASE_ANON_KEY || "",
  };

  response.setHeader("Cache-Control", "no-store");
  response.status(200).json({
    configured: Boolean(config.url && config.anonKey),
    config,
  });
};
